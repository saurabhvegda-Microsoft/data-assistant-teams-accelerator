# Alerting Configuration

## Overview

Data Assistant (this Teams app) uses Azure Monitor metric alerts to detect availability, latency, and error-rate issues. `infra/main.bicep` includes a reference alerting setup for the App Service path; adapt wiring for the active hosting target (the current demo runs on Azure Container Apps).

Current note: this document's KQL and thresholds are valid for telemetry analysis regardless of hosting target, but alert resource provisioning steps must match your deployed infrastructure.

---

## Alert Rules

| Alert | Severity | Trigger | Window |
|-------|----------|---------|--------|
| Bot Unavailable | Critical (0) | 0 successful requests | 5 min |
| High P95 Latency | Warning (2) | Avg duration > 10s | 5 min |
| High Error Rate | Warning (2) | Failed requests > 10 | 5 min |

---

## KQL Queries for Application Insights

### Bot Availability (last 24h)

```kql
requests
| where timestamp > ago(24h)
| summarize SuccessCount = countif(success == true),
            FailCount = countif(success == false)
            by bin(timestamp, 5m)
| render timechart
```

### P95 Latency by Operation

```kql
requests
| where timestamp > ago(1h)
| summarize P95 = percentile(duration, 95),
            P50 = percentile(duration, 50)
            by bin(timestamp, 5m), name
| render timechart
```

### Error Rate Percentage

```kql
requests
| where timestamp > ago(1h)
| summarize Total = count(),
            Failed = countif(success == false)
            by bin(timestamp, 5m)
| extend ErrorRate = (Failed * 100.0) / Total
| render timechart
```

### Data Agent Dependency Latency

```kql
dependencies
| where timestamp > ago(1h)
| where name contains "dataAgent"   // historical code name kept in client/span names
| summarize P95 = percentile(duration, 95),
            P50 = percentile(duration, 50),
            FailRate = countif(success == false) * 100.0 / count()
            by bin(timestamp, 5m)
| render timechart
```

### Rate-Limited Users

```kql
traces
| where timestamp > ago(24h)
| where message == "rate.limit.exceeded"
| extend userId = tostring(customDimensions.userId)
| summarize HitCount = count() by userId
| order by HitCount desc
```

### Active Users (Daily)

```kql
traces
| where timestamp > ago(7d)
| where message == "turn.start"
| extend userId = tostring(customDimensions.userId)
| summarize DailyUsers = dcount(userId) by bin(timestamp, 1d)
| render timechart
```

### Query Success vs Failure

```kql
traces
| where timestamp > ago(24h)
| where message in ("query.complete", "query.error")
| extend success = iff(message == "query.complete", "success", "error")
| summarize Count = count() by bin(timestamp, 1h), success
| render timechart
```

---

## Setting Up Action Groups

To receive notifications, create an Action Group in Azure Portal:

1. Navigate to **Monitor** → **Alerts** → **Action groups**
2. Create a new action group with email/Teams channel notifications
3. Update the alert rules in `main.bicep` to reference the action group ID:

```bicep
actions: {
  actionGroups: [{ actionGroupId: actionGroup.id }]
}
```

---

## Dashboard Recommendation

Create an Azure Workbook with:
1. Bot availability timeline
2. P50/P95 latency chart
3. Error rate gauge
4. Active users trend
5. Top queries (by frequency)
6. Rate-limited events
