import * as cdk from "aws-cdk-lib";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { ApiStack } from "./stack.js";
const fixture = {
  PLATFORM_ACCOUNT: "111111111111",
  PLATFORM_REGION: "us-east-1",
  PLATFORM_ENV: "demo",
  PLATFORM_AVAILABILITY_ZONES: "us-east-1a,us-east-1b",
  PLATFORM_SITE_ORIGIN: "https://wander.example",
  API_IMAGE_TAG: "1111111111111111111111111111111111111111",
};
function template(extra: Record<string, string> = {}) {
  return cdk.assertions.Template.fromStack(
    new ApiStack(new cdk.App(), "Api", parseConfig({ ...fixture, ...extra }))
  );
}
describe("graph Fargate contract", () => {
  it("accepts blank mock models and requires a model for selected LLMs", () => {
    for (const model of [undefined, "", "   "]) {
      expect(
        parseConfig({ ...fixture, API_LLM_PROVIDER: "mock", API_LLM_MODEL: model }).API_LLM_MODEL
      ).toBeUndefined();
      for (const provider of ["openai", "anthropic"]) {
        expect(() =>
          parseConfig({ ...fixture, API_LLM_PROVIDER: provider, API_LLM_MODEL: model })
        ).toThrow("API_LLM_MODEL");
      }
    }
    for (const provider of ["openai", "anthropic"]) {
      expect(
        parseConfig({ ...fixture, API_LLM_PROVIDER: provider, API_LLM_MODEL: "example-model" })
          .API_LLM_MODEL
      ).toBe("example-model");
    }
  });
  it("requires bounded live inputs and immutable image revisions", () => {
    expect(() => parseConfig({ ...fixture, API_IMAGE_TAG: "latest" })).toThrow("API_IMAGE_TAG");
    expect(() =>
      parseConfig({ ...fixture, PLATFORM_SITE_ORIGIN: "http://wander.example" })
    ).toThrow("PLATFORM_SITE_ORIGIN");
    expect(() =>
      parseConfig({ ...fixture, PLATFORM_AVAILABILITY_ZONES: "us-east-1a,us-east-1a" })
    ).toThrow("PLATFORM_AVAILABILITY_ZONES");
  });
  it("uses private tasks, foundation roles, live auth and healthy ALB targets", () => {
    const t = template();
    t.resourceCountIs("AWS::IAM::Role", 0);
    t.resourceCountIs("AWS::IAM::Policy", 0);
    t.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 1,
      NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: "DISABLED" } },
      DeploymentConfiguration: { MinimumHealthyPercent: 0, MaximumPercent: 100 },
    });
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: 4000,
      TargetType: "ip",
      HealthCheckPath: "/health",
    });
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", { Priority: 10 });
    t.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    const task = Object.values(t.findResources("AWS::ECS::TaskDefinition"))[0];
    const container = task.Properties.ContainerDefinitions[0];
    expect(container.Environment).toContainEqual({ Name: "APP_MODE", Value: "live" });
    expect(container.HealthCheck.Command.join(" ")).toContain("/health");
    const text = JSON.stringify(t.toJSON());
    expect(text).toContain("roles/graph-task-arn");
    expect(text).toContain("roles/graph-execution-arn");
    expect(text).toContain("compute/graph-listener-arn");
    expect(text).not.toContain("ssm:GetParameter");
    expect(text).not.toContain("AWS::Lambda");
    expect(text).toContain("compute/rest-alb-dns");
  });
  it("injects only selected secret references, never values", () => {
    const t = template({
      API_LLM_PROVIDER: "openai",
      API_LLM_MODEL: "example-model",
      API_EVENTS_PROVIDER: "ticketmaster",
    });
    const task = Object.values(t.findResources("AWS::ECS::TaskDefinition"))[0];
    const injected = task.Properties.ContainerDefinitions[0].Secrets;
    expect(injected.map((item: { Name: string }) => item.Name)).toEqual([
      "OPENAI_API_KEY",
      "TICKETMASTER_API_KEY",
    ]);
    expect(JSON.stringify(injected)).toContain("/secrets/openai");
    expect(JSON.stringify(injected)).not.toContain("PRIVATE_SECRET_SENTINEL");
    const defaults = Object.values(template().findResources("AWS::ECS::TaskDefinition"))[0];
    expect(defaults.Properties.ContainerDefinitions[0].Secrets).toBeUndefined();
  });
});
