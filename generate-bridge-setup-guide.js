/** Generates CyberTowers_Bridge_Setup_Guide.docx — how to set up the Bridge + SDK
 *  on another laptop and connect it to the web application, from basics. */
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageBreak, LevelFormat, Header, Footer, PageNumber,
} = require('docx');

const NAVY='1F3864', BLUE='2E75B6', GREY='F2F2F2', RED='C00000', GREEN='548235', AMBER='BF8F00';
const W=9360;
const bd={style:BorderStyle.SINGLE,size:1,color:'BFBFBF'};
const borders={top:bd,left:bd,bottom:bd,right:bd};
const h1=t=>new Paragraph({heading:HeadingLevel.HEADING_1,children:[new TextRun(t)]});
const h2=t=>new Paragraph({heading:HeadingLevel.HEADING_2,children:[new TextRun(t)]});
const p=(t,o={})=>new Paragraph({spacing:{after:120},children:[new TextRun({text:t,...o})]});
const sp=()=>new Paragraph({spacing:{after:80},children:[]});
const bullet=(t,lvl=0)=>new Paragraph({numbering:{reference:'b',level:lvl},spacing:{after:60},children:[new TextRun(t)]});
const numbered=t=>new Paragraph({numbering:{reference:'s',level:0},spacing:{after:80},children:[new TextRun(t)]});
function code(lines){const a=Array.isArray(lines)?lines:[lines];return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[W],rows:[new TableRow({children:[new TableCell({borders,width:{size:W,type:WidthType.DXA},shading:{fill:'1E1E1E',type:ShadingType.CLEAR},margins:{top:100,bottom:100,left:160,right:160},children:[new Paragraph({children:a.map((l,i)=>new TextRun({text:l,font:'Consolas',size:18,color:'D4D4D4',break:i>0?1:0}))})]})]})]});}
function callout(label,text,color){return new Table({width:{size:W,type:WidthType.DXA},columnWidths:[W],rows:[new TableRow({children:[new TableCell({borders:{top:{style:BorderStyle.SINGLE,size:1,color},left:{style:BorderStyle.SINGLE,size:18,color},bottom:{style:BorderStyle.SINGLE,size:1,color},right:{style:BorderStyle.SINGLE,size:1,color}},width:{size:W,type:WidthType.DXA},shading:{fill:GREY,type:ShadingType.CLEAR},margins:{top:100,bottom:100,left:160,right:160},children:[new Paragraph({children:[new TextRun({text:label+'  ',bold:true,color}),new TextRun({text,size:20})]})]})]})]});}
function table(headers,rows,widths){
  const cols=widths||headers.map(()=>Math.floor(W/headers.length));
  const hr=new TableRow({tableHeader:true,children:headers.map((h,i)=>new TableCell({borders,width:{size:cols[i],type:WidthType.DXA},shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:60,bottom:60,left:120,right:120},children:[new Paragraph({children:[new TextRun({text:h,bold:true,color:'FFFFFF',size:20})]})]}))});
  const br=rows.map((r,ri)=>new TableRow({children:r.map((cell,ci)=>{const txt=Array.isArray(cell)?cell[0]:cell;const col=Array.isArray(cell)?cell[1]:'000000';const b=Array.isArray(cell);return new TableCell({borders,width:{size:cols[ci],type:WidthType.DXA},shading:{fill:ri%2?GREY:'FFFFFF',type:ShadingType.CLEAR},margins:{top:50,bottom:50,left:120,right:120},children:[new Paragraph({children:[new TextRun({text:String(txt),size:19,color:col,bold:b})]})]});})}));
  return new Table({width:{size:W,type:WidthType.DXA},columnWidths:cols,rows:[hr,...br]});
}

const c=[];
// Cover
c.push(
  new Paragraph({spacing:{before:2300},alignment:AlignmentType.CENTER,children:[new TextRun({text:'CyberTowers',bold:true,size:72,color:NAVY})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Bridge Service & Controller SDK',bold:true,size:38,color:BLUE})]}),
  new Paragraph({spacing:{before:240},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Complete Setup & Connection Guide',size:30,color:'404040'})]}),
  new Paragraph({spacing:{before:200},alignment:AlignmentType.CENTER,children:[new TextRun({text:'How to install the Bridge and SDK on another laptop, run it,',italics:true,size:21,color:'595959'})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'and connect it to the web application — from the basics',italics:true,size:21,color:'595959'})]}),
  new Paragraph({spacing:{before:1500},alignment:AlignmentType.CENTER,children:[new TextRun({text:'Bluesprings AI',bold:true,size:22,color:NAVY})]}),
  new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Version 1.0  ·  June 2026',size:20,color:'808080'})]}),
  new Paragraph({children:[new PageBreak()]}),
);
// TOC
c.push(h1('Table of Contents'));
c.push(new TableOfContents('Table of Contents',{hyperlink:true,headingStyleRange:'1-2'}));
c.push(new Paragraph({children:[new PageBreak()]}));

// 1. What the Bridge is
c.push(h1('1. What the Bridge Is and Why You Need It'));
c.push(p('The web application (dashboard + backend + database) cannot talk to the door controllers directly — a web browser and a Node.js server have no way to speak the controllers’ hardware protocol. The Bridge Service is the piece that does this.'));
c.push(p('The Bridge is a small Windows program (.NET 8) that:'));
c.push(bullet('Loads the controller manufacturer’s SDK (the FCardCDrive / TimeWatch native DLLs).'));
c.push(bullet('Connects to each FC8900 controller over the local network.'));
c.push(bullet('Reads the list of controllers directly from the PostgreSQL database.'));
c.push(bullet('Streams live scan events and controller health back to the web backend.'));
c.push(sp());
c.push(h2('1.1 How the pieces fit together'));
c.push(code([
  '   Door reader / FC8900 controller   (on the building LAN)',
  '            ^   TCP / UDP (controller SDK protocol)',
  '            |',
  '   BRIDGE SERVICE  (this guide)  --- reads controllers --->  PostgreSQL',
  '            |   HTTP POST /internal/bridge/*                      ^',
  '            v                                                      |',
  '   Web Backend (Node.js, port 5000)  --- stores & broadcasts ----+',
  '            |   HTTPS + WebSocket',
  '            v',
  '   Dashboard in the browser',
]));
c.push(callout('KEY IDEA:','The Bridge connects to TWO things: (1) the PostgreSQL database — to read which controllers exist; and (2) the web backend over HTTP — to push live events and status. Both must be reachable from the laptop running the Bridge.',BLUE));

// 2. Files needed first
c.push(h1('2. What Files You Need First'));
c.push(p('Before anything else, make sure you have these. The SDK DLLs are the manufacturer’s files and are mandatory — the Bridge cannot talk to hardware without them.'));
c.push(h2('2.1 The Bridge project folder'));
c.push(p('Copy the entire E:\\CyberTowers.Bridge folder. The important parts are:'));
c.push(table(['Item','Purpose'],[
  ['CyberTowers.Bridge.csproj','Project definition'],
  ['Program.cs, Services\\, Infrastructure\\, Core\\, BackgroundWorkers\\','Bridge source code'],
  ['SDK\\ (folder)','The manufacturer SDK DLLs (see 2.2) — MUST be present'],
  ['appsettings.json','Configuration (backend URL, DB connection, key)'],
  ['bin\\publish\\','The compiled, ready-to-run output (created in Section 4)'],
],[4200,5160]));
c.push(sp());
c.push(h2('2.2 The controller SDK DLLs (mandatory)'));
c.push(p('These live in the SDK\\ folder and are copied next to the program when it builds. Without them the Bridge fails to start. The full set is:'));
c.push(table(['Core SDK','Native / runtime support'],[
  ['FCardCDrive.dll  (main managed SDK)','mfc100.dll, mfc100ud.dll'],
  ['CareaIfc.dll  (network init)','msvcr100.dll, msvcr100d.dll'],
  ['CtrlEx.dll, DoorCtrller.dll','msvcp100d.dll'],
  ['DataTool.dll, MyCPlusPlus.dll','libcrypto-1_1.dll, libssl-1_1.dll'],
  ['cmproxy.dll, dbproxy.dll, egcproxy.dll, netproxy.dll','libmySQL.dll'],
  ['regex2.dll, util.dll','api-ms-win-crt-string-l1-1-0.dll, ws2_32.dll, User32.dll'],
],[4680,4680]));
c.push(sp());
c.push(callout('IMPORTANT:','These SDK files come from the controller manufacturer (TimeWatch / FCard). Keep the SDK\\ folder intact. If you copy the project to a new laptop, copy this folder too — it is not downloadable from a public source.',RED));

// 3. Prerequisites
c.push(h1('3. Prerequisites on the New Laptop'));
c.push(table(['Requirement','Details'],[
  ['Windows 10/11 or Server 2019+','The Bridge is a Windows program'],
  ['.NET 8 SDK','Needed to build/publish. Download from dotnet.microsoft.com'],
  ['Network access to the controllers','Same LAN/subnet as the FC8900 devices'],
  ['Network access to the database + backend','Usually the same machine or LAN'],
  ['The web application already running','Backend on port 5000 + PostgreSQL (see the Installation Guide)'],
],[3400,5960]));
c.push(sp());
c.push(callout('ARCHITECTURE NOTE:','The controller SDK is 32-bit, so the Bridge MUST run as a 32-bit (x86) program. The build command in Section 4 produces a self-contained x86 build that bundles its own runtime, so you do NOT need to install a separate 32-bit .NET runtime.',AMBER));

// 4. Build / publish
c.push(h1('4. Build the Bridge (Self-Contained x86)'));
c.push(p('This compiles the Bridge and bundles the 32-bit runtime and SDK DLLs into one folder you can run anywhere. Open PowerShell in the project folder and run:'));
c.push(code([
  'cd E:\\CyberTowers.Bridge',
  'dotnet publish CyberTowers.Bridge.csproj -c Release -r win-x86 --self-contained true -p:SelfContained=true -o bin\\publish',
]));
c.push(p('When it finishes, the ready-to-run program is at:'));
c.push(code(['E:\\CyberTowers.Bridge\\bin\\publish\\CyberTowers.Bridge.exe']));
c.push(p('Confirm the SDK DLLs and runtime landed in that folder (these must all be present):'));
c.push(code(['Get-ChildItem bin\\publish | Where-Object { $_.Name -match \'FCardCDrive|CareaIfc|coreclr|hostfxr\' }']));
c.push(callout('WHY SELF-CONTAINED:','A normal build needs a 32-bit .NET runtime installed on the machine, which usually is not. Self-contained bundles it, so the exe runs on any Windows laptop without extra installs.',GREEN));

// 5. Configure
c.push(h1('5. Configure the Bridge'));
c.push(p('Open bin\\publish\\appsettings.json and set three things so the Bridge can reach the database and the backend.'));
c.push(h2('5.1 Settings to fill in'));
c.push(table(['Setting','What to put','Example'],[
  ['Bridge:BackendApiBaseUrl','URL of the web backend','http://localhost:5000'],
  ['Bridge:BackendApiKey','Same API key as backend .env','37e7… (your key)'],
  ['Database:ConnectionString','PostgreSQL connection (use 127.0.0.1, not localhost)','see below'],
],[3000,3360,3000]));
c.push(sp());
c.push(p('Example appsettings.json (the important lines):'));
c.push(code([
  '{',
  '  "Bridge": {',
  '    "BackendApiBaseUrl": "http://localhost:5000",',
  '    "BackendApiKey": "<same key as backend .env API_KEY>",',
  '    "SignalRHubUrl": "",',
  '    "HealthCheckIntervalSeconds": 30',
  '  },',
  '  "Database": {',
  '    "ConnectionString": "Host=127.0.0.1;Port=5432;Database=cybertowers_access;Username=postgres;Password=<your db password>"',
  '  }',
  '}',
]));
c.push(callout('TWO GOTCHAS:','(1) Use Host=127.0.0.1 — the word "localhost" causes a DNS error in the 32-bit build. (2) Leave SignalRHubUrl empty — the backend uses plain WebSocket; the Bridge sends events over HTTP and skips SignalR automatically.',RED));
c.push(p('If the database or backend is on another machine, replace 127.0.0.1 and localhost with that machine’s IP address (and make sure PostgreSQL/firewall allow it).'));

// 6. Run it
c.push(h1('6. Run the Bridge'));
c.push(h2('6.1 Quick test run (console)'));
c.push(p('Run the program directly to watch it start and confirm there are no errors:'));
c.push(code(['cd E:\\CyberTowers.Bridge\\bin\\publish', '.\\CyberTowers.Bridge.exe']));
c.push(p('A healthy start prints lines like these, then keeps running:'));
c.push(code([
  'TimeWatch SDK initialised successfully',
  'Loaded N active controller(s) from database',
  'EventProcessorWorker started',
  'HealthCheckWorker started - interval 30 s',
  'ControllerMonitorWorker started - monitoring N controllers',
]));
c.push(p('Press Ctrl+C to stop the test run.'));
c.push(h2('6.2 Install as a Windows service (recommended for production)'));
c.push(p('So the Bridge starts automatically on boot and runs in the background, install it as a service from an Administrator PowerShell:'));
c.push(code([
  'sc.exe create "CyberTowers Bridge Service" binPath= "E:\\CyberTowers.Bridge\\bin\\publish\\CyberTowers.Bridge.exe" start= auto',
  'sc.exe start  "CyberTowers Bridge Service"',
]));
c.push(p('Check it is running:'));
c.push(code(['Get-Service "CyberTowers Bridge Service"']));
c.push(p('To stop or remove it later:'));
c.push(code(['sc.exe stop "CyberTowers Bridge Service"','sc.exe delete "CyberTowers Bridge Service"']));

// 7. Connect to web app / add controller
c.push(h1('7. Connect the Bridge to the Web Application'));
c.push(p('The Bridge connects to the web application automatically once it is configured (Section 5) and running (Section 6) — it reads the controller list from the database and posts events to the backend. The only remaining step is telling the system which physical controllers exist.'));
c.push(h2('7.1 Add a controller in the dashboard'));
c.push(numbered('Open the dashboard, go to Configuration → Controllers → Add Controller.'));
c.push(numbered('Enter the controller’s Serial Number, IP address, TCP port, UDP port, and password.'));
c.push(numbered('Save. The controller row is now in the database.'));
c.push(numbered('The Bridge picks it up automatically (it re-reads controllers on its monitor cycle), connects, and within ~30 seconds the controller shows Online in the Controllers tab and in Bridge Monitor.'));
c.push(numbered('Add cards and use Push / Sync All to write them to the controller. Live scans then stream into the Events tab.'));
c.push(sp());
c.push(h2('7.2 How to confirm the connection is working'));
c.push(table(['Where to look','What you should see'],[
  ['Bridge console / log','"Loaded 1 active controller", connection + heartbeat messages'],
  ['Dashboard → Controllers','The controller listed as Online with a recent heartbeat'],
  ['Dashboard → Bridge Monitor','Bridge online, controller online, sync activity'],
  ['Dashboard → Events','New scan events appearing in real time'],
],[3600,5760]));

// 8. Complete flow checklist
c.push(h1('8. Complete Setup Flow (Checklist)'));
c.push(numbered('Confirm the web application is running (backend on 5000 + PostgreSQL).'));
c.push(numbered('Copy the E:\\CyberTowers.Bridge folder, including the SDK\\ folder, to the laptop.'));
c.push(numbered('Install the .NET 8 SDK.'));
c.push(numbered('Publish the Bridge self-contained x86 (Section 4).'));
c.push(numbered('Edit appsettings.json: backend URL, API key, DB connection with Host=127.0.0.1 (Section 5).'));
c.push(numbered('Test-run the exe and confirm "TimeWatch SDK initialised successfully" with no errors (Section 6.1).'));
c.push(numbered('Install it as a Windows service for auto-start (Section 6.2).'));
c.push(numbered('Add the physical controllers in the dashboard (Section 7).'));
c.push(numbered('Verify Online status and live events (Section 7.2).'));

// 9. Troubleshooting
c.push(h1('9. Troubleshooting'));
c.push(table(['Message / symptom','Cause','Fix'],[
  ['"You must install .NET ... Architecture: x86"','Built framework-dependent','Re-publish with --self-contained true (Section 4)'],
  ['"ConnectMain type not found in FCardCDrive.dll"','SDK DLLs missing from output','Ensure the SDK\\ folder is present before building'],
  ['"GetAddrInfoExW ... ws2_32.dll"','DB host set to "localhost"','Use Host=127.0.0.1 in the connection string'],
  ['"ConnectionString property has not been initialized"','Empty DB connection','Fill Database:ConnectionString (Section 5)'],
  ['"Invalid URI: The URI is empty" (SignalR)','SignalRHubUrl blank on old build','Update to current build; it skips SignalR safely'],
  ['Controller stays Offline','Wrong IP/password, or device unreachable','Verify network, IP, port, password; ping the controller'],
],[3200,2900,3260]));
c.push(sp());
c.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:400},children:[new TextRun({text:'— End of Guide —',italics:true,color:'808080',size:20})]}));

const doc=new Document({
  styles:{default:{document:{run:{font:'Arial',size:22}}},paragraphStyles:[
    {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:30,bold:true,color:NAVY},paragraph:{spacing:{before:320,after:160},outlineLevel:0,border:{bottom:{style:BorderStyle.SINGLE,size:6,color:BLUE,space:4}}}},
    {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:24,bold:true,color:BLUE},paragraph:{spacing:{before:200,after:100},outlineLevel:1}},
  ]},
  numbering:{config:[
    {reference:'b',levels:[
      {level:0,format:LevelFormat.BULLET,text:'•',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:720,hanging:360}}}},
      {level:1,format:LevelFormat.BULLET,text:'◦',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:1440,hanging:360}}}},
    ]},
    {reference:'s',levels:[{level:0,format:LevelFormat.DECIMAL,text:'%1.',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:720,hanging:360}}}}]},
  ]},
  sections:[{
    properties:{page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440}}},
    headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'CyberTowers — Bridge & SDK Setup Guide',size:16,color:'808080'})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'Page ',size:16,color:'808080'}),new TextRun({children:[PageNumber.CURRENT],size:16,color:'808080'})]})]})},
    children:c,
  }],
});
Packer.toBuffer(doc).then(b=>{fs.writeFileSync('CyberTowers_Bridge_Setup_Guide.docx',b);console.log('Wrote CyberTowers_Bridge_Setup_Guide.docx ('+(b.length/1024).toFixed(1)+' KB)');});
