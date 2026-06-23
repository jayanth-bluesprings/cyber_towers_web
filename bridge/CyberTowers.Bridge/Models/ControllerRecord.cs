namespace CyberTowers.Bridge.Models;

/// <summary>Matches the shape of controllers rows returned by Express.</summary>
public sealed class ControllerRecord
{
    public string Id                { get; set; } = "";
    public string Sn                { get; set; } = "";
    public string IpAddress         { get; set; } = "";
    public int    TcpPort           { get; set; } = 8000;
    public int    UdpPort           { get; set; } = 8101;
    public string PasswordEncrypted { get; set; } = "";
    public int    DoorCount         { get; set; } = 1;
    public string LocationLabel     { get; set; } = "";
    public bool   IsActive          { get; set; } = true;
}

/// <summary>Payload for POST /internal/bridge/controllers/discovered.</summary>
public sealed class DiscoveredControllerDto
{
    public string Sn            { get; set; } = "";
    public string IpAddress     { get; set; } = "";
    public int    TcpPort       { get; set; } = 8000;
    public int    UdpPort       { get; set; } = 8101;
    public string LocationLabel { get; set; } = "";
}
