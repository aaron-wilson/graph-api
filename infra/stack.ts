import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { ApiConfig } from "./config.js";
const {
  aws_ec2: ec2,
  aws_ecs: ecs,
  aws_iam: iam,
  aws_logs: logs,
  aws_ssm: ssm,
  aws_elasticloadbalancingv2: alb,
  aws_secretsmanager: secrets,
} = cdk;
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, c: ApiConfig) {
    super(scope, id, { env: { account: c.PLATFORM_ACCOUNT, region: c.PLATFORM_REGION } });
    const prefix = `/wander/${c.PLATFORM_ENV}/v1`;
    const ref = (key: string) =>
      ssm.StringParameter.valueForStringParameter(this, `${prefix}/${key}`);
    const vpc = ec2.Vpc.fromVpcAttributes(this, "Vpc", {
      vpcId: ref("network/vpc-id"),
      availabilityZones: c.PLATFORM_AVAILABILITY_ZONES.split(","),
      privateSubnetIds: [ref("network/private-subnet-1-id"), ref("network/private-subnet-2-id")],
    });
    const cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName: `wander-${c.PLATFORM_ENV}`,
      vpc,
    });
    const role = (kind: string) =>
      iam.Role.fromRoleArn(this, kind, ref(`roles/graph-${kind}-arn`), { mutable: false });
    const task = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: role("task"),
      executionRole: role("execution"),
    });
    const environment: Record<string, string> = {
      APP_MODE: "live",
      PORT: "4000",
      AWS_REGION: c.PLATFORM_REGION,
      CORS_ORIGIN: c.PLATFORM_SITE_ORIGIN,
      COGNITO_USER_POOL_ID: ref("auth/user-pool-id"),
      COGNITO_CLIENT_ID: ref("auth/browser-client-id"),
      TELEMETRY_MODE: "off",
      LOG_LEVEL: "info",
    };
    const injected: Record<string, cdk.aws_ecs.Secret> = {};
    environment.REST_URL = `http://${ref("compute/rest-alb-dns")}:3000`;
    environment.PROVIDER_LLM = c.API_LLM_PROVIDER;
    environment.PROVIDER_EVENTS = c.API_EVENTS_PROVIDER;
    if (c.API_LLM_PROVIDER !== "mock") {
      const vendor = c.API_LLM_PROVIDER;
      environment[`${vendor.toUpperCase()}_MODEL`] = c.API_LLM_MODEL ?? "";
      injected[`${vendor.toUpperCase()}_API_KEY`] = ecs.Secret.fromSecretsManager(
        secrets.Secret.fromSecretNameV2(this, "LlmSecret", `${prefix}/secrets/${vendor}`)
      );
    }
    if (c.API_EVENTS_PROVIDER === "ticketmaster")
      injected.TICKETMASTER_API_KEY = ecs.Secret.fromSecretsManager(
        secrets.Secret.fromSecretNameV2(this, "EventsSecret", `${prefix}/secrets/ticketmaster`)
      );
    task.addContainer("Api", {
      image: ecs.ContainerImage.fromRegistry(
        `${ref("images/graph-repository-uri")}:${c.API_IMAGE_TAG}`
      ),
      environment,
      secrets: injected,
      portMappings: [{ containerPort: 4000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "graph",
        logGroup: logs.LogGroup.fromLogGroupName(this, "Logs", ref("logs/api-group-name")),
      }),
      healthCheck: {
        command: [
          "CMD-SHELL",
          "node -e \"fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
    });
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: task,
      serviceName: `wander-${c.PLATFORM_ENV}-graph`,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [
        ec2.SecurityGroup.fromSecurityGroupId(
          this,
          "Tasks",
          ref("network/graph-task-security-group-id"),
          { mutable: false }
        ),
      ],
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });
    const targets = new alb.ApplicationTargetGroup(this, "Targets", {
      vpc,
      port: 4000,
      protocol: alb.ApplicationProtocol.HTTP,
      targetType: alb.TargetType.IP,
      healthCheck: { path: "/health", healthyHttpCodes: "200", interval: cdk.Duration.seconds(30) },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    targets.addTarget(service);
    const rule = new alb.CfnListenerRule(this, "Route", {
      listenerArn: ref("compute/graph-listener-arn"),
      priority: 10,
      conditions: [{ field: "path-pattern", values: ["/*"] }],
      actions: [{ type: "forward", targetGroupArn: targets.targetGroupArn }],
    });
    service.node.addDependency(rule);
    new cdk.aws_cloudwatch.Alarm(this, "CpuAlarm", {
      alarmName: `wander-${c.PLATFORM_ENV}-graph-cpu`,
      metric: service.metricCpuUtilization({ period: cdk.Duration.minutes(1) }),
      threshold: 85,
      evaluationPeriods: 3,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cdk.CfnOutput(this, "ServiceName", { value: service.serviceName });
  }
}
