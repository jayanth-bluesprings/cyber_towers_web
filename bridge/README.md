# CyberTowers Bridge Service

A .NET 8 Windows Service that bridges **FC8900 RFID controllers** to the CyberTowers vehicle access dashboard.

## What it does

| Feature | Details |
|---------|---------|
| **UDP Discovery** | Broadcasts to LAN every 60 s; auto-registers new FC8900 controllers in the dashboard |
| **Heartbeat** | Pings each controller every 30 s; updates online/offline status in real time |
| **Card Push** | Polls Express for pending push jobs; calls `WriteCardMain` + verifies with `ReadCardMain` |
| **Historical Sync** | Fetches stored records from each controller every 60 min via `GetRecords` |
| **Event Ingest** | Posts access events to Express → stored in PostgreSQL → broadcast to browser via WebSocket |

## Architecture

```
Browser ←── WebSocket ──→ Express (Node :5000)
                                ↑
                        /internal/bridge/*
                                ↑
                    CyberTowers.Bridge.exe  ←── FC8900 SDK DLL
                                ↑
                         FC8900 Controllers (LAN)
```

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| .NET 8 SDK | https://dotnet.microsoft.com/download |
| Windows (x86 or x64) | SDK DLL is 32-bit; Bridge runs as x86 |
| FC8900SDK.dll | Copy to `CyberTowers.Bridge\Sdk\` before building |
| Express backend running | Default `http://localhost:5000` |

## Folder structure

```
bridge/
├── CyberTowers.Bridge.sln
├── install-service.ps1          ← PowerShell installer
└── CyberTowers.Bridge/
    ├── appsettings.json
    ├── appsettings.Development.json
    ├── Program.cs
    ├── Models/
    │   ├── BridgeOptions.cs
    │   ├── CardPushModels.cs
    │   ├── ControllerRecord.cs
    │   └── EventIngestDto.cs
    ├── Sdk/
    │   ├── IFC8900Sdk.cs          ← interface
    │   ├── FC8900SdkWrapper.cs    ← real DLL P/Invoke
    │   └── FC8900SdkStub.cs       ← in-memory stub (dev/test)
    ├── Services/
    │   ├── ExpressApiClient.cs
    │   ├── DiscoveryService.cs
    │   ├── ControllerSession.cs
    │   └── CardPushService.cs
    └── Workers/
        └── BridgeWorker.cs
```

## Development (no hardware / DLL)

```jsonc
// appsettings.Development.json — already configured:
{
  "Bridge": {
    "UseStubSdk": true,              // simulated controller, no DLL needed
    "DiscoveryIntervalSeconds": 30,
    "HeartbeatIntervalSeconds": 10,
    "CardPushPollIntervalSeconds": 5,
    "HistoricalSyncIntervalMinutes": 5
  }
}
```

```powershell
cd bridge\CyberTowers.Bridge
$env:DOTNET_ENVIRONMENT = "Development"
dotnet run
```

The stub automatically seeds 30 historical card-access records and simulates WriteCardMain/ReadCardMain.

## Production install

```powershell
# Run PowerShell as Administrator
cd bridge

# Install + start service (uses real FC8900 DLL)
.\install-service.ps1

# Install with stub SDK for testing on a machine without controllers
.\install-service.ps1 -UseStub

# Change Express URL (e.g. production server)
.\install-service.ps1 -ExpressUrl "http://192.168.1.10:5000"

# Uninstall
.\install-service.ps1 -Action uninstall
```

The installer:
1. Runs `dotnet publish` (x86, single-file EXE)
2. Patches `appsettings.json` with your `ExpressUrl`
3. Registers `CyberTowersBridge` as a Windows Service set to **Automatic** start
4. Starts the service immediately

## Wiring up the real FC8900 SDK DLL

1. Copy `FC8900SDK.dll` into `bridge\CyberTowers.Bridge\Sdk\`
2. Open `FC8900SdkWrapper.cs` and verify:
   - The `[DllImport("FC8900SDK")]` name matches the actual DLL filename
   - Native function names (`FC8900_Login`, `FC8900_WriteCardMain`, etc.) match the SDK header
   - `NativeCardRecord` struct layout matches the SDK struct
3. Build and test on hardware with `UseStubSdk = false`

## Configuration reference

All values live under `Bridge:` in `appsettings.json`:

| Key | Default | Description |
|-----|---------|-------------|
| `ExpressBaseUrl` | `http://localhost:5000` | Express backend URL |
| `DiscoveryPort` | `8101` | UDP port FC8900 listens on for discovery |
| `DiscoveryIntervalSeconds` | `60` | How often to broadcast UDP probe |
| `HeartbeatIntervalSeconds` | `30` | Controller ping interval |
| `CardPushPollIntervalSeconds` | `10` | How often to check for pending push jobs |
| `CardPushMaxRetries` | `3` | Max WriteCardMain attempts before marking Failed |
| `CardPushRetryBaseSeconds` | `5` | Retry delay = base × attempt number |
| `HistoricalSyncIntervalMinutes` | `60` | How often to fetch stored records |
| `UseStubSdk` | `false` | Use in-memory stub instead of real DLL |

## Logs

- **Console**: visible when running `dotnet run` in development
- **Windows Event Log**: Application → source `CyberTowers.Bridge` (production service)
- **Structured logs**: all key events include controller SN, card number, and result
