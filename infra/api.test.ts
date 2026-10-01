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
  it("defaults every provider to mock and maps each real selection to the task", () => {
    const environment = (extra: Record<string, string> = {}) => {
      const task = Object.values(template(extra).findResources("AWS::ECS::TaskDefinition"))[0];
      const container = task.Properties.ContainerDefinitions[0];
      return {
        values: Object.fromEntries(
          (container.Environment as { Name: string; Value: unknown }[]).map((item) => [
            item.Name,
            item.Value,
          ])
        ),
        secrets: ((container.Secrets ?? []) as { Name: string }[]).map((item) => item.Name),
      };
    };
    const blanks: Record<string, string>[] = [
      {},
      { API_WEATHER_PROVIDER: "", API_PLACES_PROVIDER: " " },
    ];
    for (const blank of blanks) {
      const defaults = environment(blank);
      expect(defaults.values).toMatchObject({
        PROVIDER_WEATHER: "mock",
        PROVIDER_PLACES: "mock",
        PROVIDER_EVENTS: "mock",
        PROVIDER_LLM: "mock",
      });
      expect(defaults.secrets).toEqual([]);
      expect(Object.keys(defaults.values).join(" ")).not.toMatch(/_MODEL|_API_KEY/);
    }
    const open = environment({ API_WEATHER_PROVIDER: "wttr", API_PLACES_PROVIDER: "overpass" });
    expect(open.values).toMatchObject({ PROVIDER_WEATHER: "wttr", PROVIDER_PLACES: "overpass" });
    expect(open.secrets).toEqual([]);
    const cases: [Record<string, string>, Record<string, string>, string[]][] = [
      [
        { API_LLM_PROVIDER: "openai", API_LLM_MODEL: "example-model" },
        { PROVIDER_LLM: "openai", OPENAI_MODEL: "example-model" },
        ["OPENAI_API_KEY"],
      ],
      [
        { API_LLM_PROVIDER: "anthropic", API_LLM_MODEL: "example-model" },
        { PROVIDER_LLM: "anthropic", ANTHROPIC_MODEL: "example-model" },
        ["ANTHROPIC_API_KEY"],
      ],
      [
        { API_EVENTS_PROVIDER: "ticketmaster" },
        { PROVIDER_EVENTS: "ticketmaster" },
        ["TICKETMASTER_API_KEY"],
      ],
    ];
    for (const [input, values, secrets] of cases) {
      const selected = environment(input);
      expect(selected.values).toMatchObject(values);
      expect(selected.secrets).toEqual(secrets);
    }
    const anthropic = environment({
      API_LLM_PROVIDER: "anthropic",
      API_LLM_MODEL: "example-model",
    });
    expect(anthropic.values).not.toHaveProperty("OPENAI_MODEL");
  });
  it("rejects unknown selections and malformed models without echoing values", () => {
    const rejected: [Record<string, string>, string][] = [
      [{ API_WEATHER_PROVIDER: "PRIVATE_SENTINEL" }, "API_WEATHER_PROVIDER"],
      [{ API_PLACES_PROVIDER: "wttr" }, "API_PLACES_PROVIDER"],
      [{ API_EVENTS_PROVIDER: "PRIVATE_SENTINEL" }, "API_EVENTS_PROVIDER"],
      [
        { API_LLM_PROVIDER: "openai", API_LLM_MODEL: "bad model PRIVATE_SENTINEL" },
        "API_LLM_MODEL",
      ],
    ];
    for (const [input, key] of rejected) {
      let message = "";
      try {
        parseConfig({ ...fixture, ...input });
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).toContain(key);
      expect(message).not.toContain("PRIVATE_SENTINEL");
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
