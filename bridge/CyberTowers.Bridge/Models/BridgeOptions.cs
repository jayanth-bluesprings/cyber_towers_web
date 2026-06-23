namespace CyberTowers.Bridge.Models;

public sealed class BridgeOptions
{
    public string ExpressBaseUrl          { get; set; } = "http://localhost:5000";
    public int    DiscoveryPort           { get; set; } = 8101;
    public int    DiscoveryIntervalSeconds{ get; set; } = 60;
    public int    HeartbeatIntervalSeconds{ get; set; } = 30;
    public int    CardPushPollIntervalSeconds { get; set; } = 10;
    public int    CardPushMaxRetries      { get; set; } = 3;
    public int    CardPushRetryBaseSeconds{ get; set; } = 5;
    public int    HistoricalSyncIntervalMinutes { get; set; } = 60;
    public bool   UseStubSdk             { get; set; } = false;
}
