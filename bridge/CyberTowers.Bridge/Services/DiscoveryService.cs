using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using CyberTowers.Bridge.Models;
using Microsoft.Extensions.Options;

namespace CyberTowers.Bridge.Services;

/// <summary>
/// Broadcasts a UDP discovery packet to 255.255.255.255:{DiscoveryPort}.
/// FC8900 controllers on the LAN respond with their serial number and IP.
/// Discovered controllers are reported to Express via POST /internal/bridge/controllers/discovered.
/// </summary>
public sealed class DiscoveryService
{
    // FC8900 discovery magic bytes — broadcast and controller replies with identity.
    // Adjust if your SDK documentation specifies a different probe format.
    private static readonly byte[] ProbePacket = Encoding.ASCII.GetBytes("FC8900DISCOVER");

    private readonly BridgeOptions         _opts;
    private readonly ExpressApiClient      _api;
    private readonly ILogger<DiscoveryService> _log;

    public DiscoveryService(IOptions<BridgeOptions> opts, ExpressApiClient api,
        ILogger<DiscoveryService> log)
    {
        _opts = opts.Value;
        _api  = api;
        _log  = log;
    }

    /// <summary>
    /// Run one discovery cycle: broadcast UDP probe, collect replies for 3 s,
    /// report each new controller to Express.
    /// </summary>
    public async Task DiscoverAsync(CancellationToken ct)
    {
        _log.LogInformation("UDP discovery broadcast → port {Port}", _opts.DiscoveryPort);

        using var udp = new UdpClient();
        udp.EnableBroadcast = true;
        // Allow reuse so multiple services can listen on the same port.
        udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);

        try
        {
            udp.Client.Bind(new IPEndPoint(IPAddress.Any, 0));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not bind UDP socket for discovery");
            return;
        }

        // Send broadcast probe
        try
        {
            var dest = new IPEndPoint(IPAddress.Broadcast, _opts.DiscoveryPort);
            await udp.SendAsync(ProbePacket, ProbePacket.Length, dest);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "UDP broadcast failed");
            return;
        }

        // Collect replies for 3 seconds
        var deadline = DateTime.UtcNow.AddSeconds(3);
        var discovered = new HashSet<string>();

        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            udp.Client.ReceiveTimeout = 500;
            try
            {
                var result = await udp.ReceiveAsync(ct);
                var dto    = ParseReply(result.Buffer, result.RemoteEndPoint.Address.ToString());
                if (dto == null) continue;
                if (discovered.Add(dto.Sn))
                {
                    _log.LogInformation("Discovered controller SN={Sn} IP={Ip}", dto.Sn, dto.IpAddress);
                    await _api.ReportDiscoveredAsync(dto, ct);
                }
            }
            catch (OperationCanceledException) { break; }
            catch (SocketException) { /* timeout — keep waiting */ }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Error receiving UDP discovery reply");
            }
        }

        _log.LogInformation("Discovery cycle complete — found {Count} controller(s)", discovered.Count);
    }

    // ── Reply parsing ──────────────────────────────────────────────────────────

    /// <summary>
    /// FC8900 controllers reply with a JSON or fixed-field binary packet.
    /// We try JSON first (for newer firmware), then fall back to a simple
    /// ASCII text format "SN=XXXXXXXX;IP=x.x.x.x;PORT=8000".
    /// Adjust this parser once you have the actual reply format from the SDK docs.
    /// </summary>
    private DiscoveredControllerDto? ParseReply(byte[] data, string senderIp)
    {
        if (data.Length == 0) return null;

        // Try JSON
        try
        {
            var text = Encoding.UTF8.GetString(data).Trim();
            if (text.StartsWith("{"))
            {
                var obj = JsonSerializer.Deserialize<JsonElement>(text);
                return new DiscoveredControllerDto
                {
                    Sn        = obj.TryGetProperty("sn",  out var sn)  ? sn.GetString()  ?? "" : "",
                    IpAddress = obj.TryGetProperty("ip",  out var ip)  ? ip.GetString()  ?? senderIp : senderIp,
                    TcpPort   = obj.TryGetProperty("port",out var port)? port.GetInt32() : 8000,
                    UdpPort   = _opts.DiscoveryPort,
                };
            }

            // Try key=value format
            if (text.Contains("SN="))
            {
                var parts = text.Split(';')
                    .Select(p => p.Split('='))
                    .Where(p => p.Length == 2)
                    .ToDictionary(p => p[0].Trim(), p => p[1].Trim());

                return new DiscoveredControllerDto
                {
                    Sn        = parts.GetValueOrDefault("SN", ""),
                    IpAddress = parts.GetValueOrDefault("IP", senderIp),
                    TcpPort   = int.TryParse(parts.GetValueOrDefault("PORT", "8000"), out var p) ? p : 8000,
                    UdpPort   = _opts.DiscoveryPort,
                };
            }
        }
        catch (Exception ex)
        {
            _log.LogTrace(ex, "Could not parse discovery reply from {Ip}", senderIp);
        }

        // Fallback: use sender IP with a generated SN (controller at least responded)
        if (senderIp is { Length: > 0 })
        {
            return new DiscoveredControllerDto
            {
                Sn        = $"FC-{senderIp.Replace('.', '-')}",
                IpAddress = senderIp,
                TcpPort   = 8000,
                UdpPort   = _opts.DiscoveryPort,
            };
        }
        return null;
    }
}
