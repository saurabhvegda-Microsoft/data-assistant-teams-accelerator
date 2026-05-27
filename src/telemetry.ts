import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

let sdk: NodeSDK | undefined;

if (connectionString) {
  const { AzureMonitorTraceExporter, AzureMonitorMetricExporter, AzureMonitorLogExporter } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@azure/monitor-opentelemetry-exporter");

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "data-assistant-teams-bot",
      [ATTR_SERVICE_VERSION]: "1.0.0",
    }),
    traceExporter: new AzureMonitorTraceExporter({ connectionString }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new AzureMonitorMetricExporter({ connectionString }),
      exportIntervalMillis: 60000,
    }),
    logRecordProcessor: new BatchLogRecordProcessor(
      new AzureMonitorLogExporter({ connectionString })
    ),
  });

  sdk.start();

  process.on("SIGTERM", () => {
    sdk?.shutdown().catch(() => {});
  });
}

export { sdk };
