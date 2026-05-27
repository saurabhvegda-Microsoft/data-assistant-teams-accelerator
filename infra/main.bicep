param location string = resourceGroup().location
param botId string
param botSku string = 'F0'
param appServicePlanSku string = 'B1'
param appServiceName string
param botServiceName string
param dataAgentApiKey string = ''

// --- Log Analytics + Application Insights ---

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${appServiceName}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${appServiceName}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// --- Key Vault ---

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${appServiceName}-kv'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
  }
}

resource secretBotPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'BotPassword'
  properties: { value: 'PLACEHOLDER' }
}

resource secretDataAgentApiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'DataAgentApiKey'
  properties: { value: dataAgentApiKey }
}

// --- App Service ---

resource appServicePlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: '${appServiceName}-plan'
  location: location
  sku: { name: appServicePlanSku }
  properties: { reserved: true }
  kind: 'linux'
}

resource appService 'Microsoft.Web/sites@2022-09-01' = {
  name: appServiceName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appSettings: [
        { name: 'BOT_ID', value: botId }
        { name: 'BOT_PASSWORD', value: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=BotPassword)' }
        { name: 'USE_MOCK_CLIENT', value: 'false' }
        { name: 'DATA_AGENT_API_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=DataAgentApiKey)' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
      ]
    }
  }
}

// --- RBAC: App Service → Key Vault Secrets User ---

resource kvSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appService.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: keyVault
  properties: {
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

// --- Bot Service ---

resource botService 'Microsoft.BotService/botServices@2022-09-15' = {
  name: botServiceName
  location: 'global'
  kind: 'azurebot'
  sku: { name: botSku }
  properties: {
    displayName: 'Financial Data Agent'
    endpoint: 'https://${appService.properties.defaultHostName}/api/messages'
    msaAppId: botId
    msaAppType: 'MultiTenant'
  }
}

resource teamsChannel 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: botService
  name: 'MsTeamsChannel'
  location: 'global'
  properties: { channelName: 'MsTeamsChannel' }
}

// --- Alert Rules ---

resource alertBotUnavailable 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appServiceName}-bot-unavailable'
  location: 'global'
  properties: {
    description: 'No successful requests in 5 minutes'
    severity: 0
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'NoRequests'
          metricName: 'requests/count'
          metricNamespace: 'microsoft.insights/components'
          operator: 'LessThanOrEqual'
          threshold: 0
          timeAggregation: 'Count'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
  }
}

resource alertHighLatency 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appServiceName}-high-latency'
  location: 'global'
  properties: {
    description: 'P95 latency > 10s for 5 minutes'
    severity: 2
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HighP95'
          metricName: 'requests/duration'
          metricNamespace: 'microsoft.insights/components'
          operator: 'GreaterThan'
          threshold: 10000
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
  }
}

resource alertHighErrorRate 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appServiceName}-high-error-rate'
  location: 'global'
  properties: {
    description: 'Error rate > 10% in 5 minute window'
    severity: 2
    enabled: true
    scopes: [appInsights.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'HighErrors'
          metricName: 'requests/failed'
          metricNamespace: 'microsoft.insights/components'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Count'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
  }
}

// --- Outputs ---

output appServiceUrl string = 'https://${appService.properties.defaultHostName}'
output botServiceName string = botService.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output keyVaultName string = keyVault.name
