// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }

function buildTS(daysBack, hour, min = 0, sec = 0) {
  const d = new Date(2026, 4, 19); // May 19 2026 in local time
  d.setDate(d.getDate() - daysBack);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(min)}:${pad(sec)}`;
}

function getDOW(daysBack) {
  const d = new Date(2026, 4, 19);
  d.setDate(d.getDate() - daysBack);
  return d.getDay(); // 0=Sun,6=Sat
}

// ─── Companies ────────────────────────────────────────────────────────────────

export const DUMMY_COMPANIES = [
  { id: 1001, companyName: 'Microsoft India',                parkingSlots: '22', blockOrQuadrant: 'Block A', adminName: 'Ananya Krishnan',  adminEmail: 'ananya.k@microsoft.com',      phoneNumber: '9876543210' },
  { id: 1002, companyName: 'Google India',                   parkingSlots: '20', blockOrQuadrant: 'Block B', adminName: 'Priya Sharma',     adminEmail: 'priya.s@google.com',          phoneNumber: '9876543211' },
  { id: 1003, companyName: 'Amazon India',                   parkingSlots: '25', blockOrQuadrant: 'Block C', adminName: 'Vikram Singh',     adminEmail: 'vikram.s@amazon.com',         phoneNumber: '9876543212' },
  { id: 1004, companyName: 'Infosys Ltd',                    parkingSlots: '18', blockOrQuadrant: 'Block D', adminName: 'Rajesh Kumar',     adminEmail: 'rajesh.k@infosys.com',        phoneNumber: '9876543213' },
  { id: 1005, companyName: 'Wipro Technologies',             parkingSlots: '15', blockOrQuadrant: 'Block E', adminName: 'Sunita Rao',       adminEmail: 'sunita.r@wipro.com',          phoneNumber: '9876543214' },
  { id: 1006, companyName: 'Tata Consultancy Services',      parkingSlots: '20', blockOrQuadrant: 'Block F', adminName: 'Ravi Teja',        adminEmail: 'ravi.t@tcs.com',              phoneNumber: '9876543215' },
  { id: 1007, companyName: 'Tech Mahindra',                  parkingSlots: '15', blockOrQuadrant: 'Block G', adminName: 'Amit Patel',       adminEmail: 'amit.p@techmahindra.com',     phoneNumber: '9876543216' },
  { id: 1008, companyName: 'Cognizant Technology Solutions', parkingSlots: '16', blockOrQuadrant: 'Block H', adminName: 'Deepa Nair',       adminEmail: 'deepa.n@cognizant.com',       phoneNumber: '9876543217' },
  { id: 1009, companyName: 'Deloitte India',                 parkingSlots: '12', blockOrQuadrant: 'Block I', adminName: 'Suresh Babu',      adminEmail: 'suresh.b@deloitte.com',       phoneNumber: '9876543218' },
  { id: 1010, companyName: 'JP Morgan Services India',       parkingSlots: '10', blockOrQuadrant: 'Block J', adminName: 'Kavitha Reddy',    adminEmail: 'kavitha.r@jpmorgan.com',      phoneNumber: '9876543219' },
];

// ─── Vehicle Definitions ──────────────────────────────────────────────────────
// [cardId, vehicleRegNo (PName), companyCode (flatNumber), vehicleType, bloodGroup, ownerName]

const VDEFS = [
  ['5248001', 'TS09AB1234', 'MSF-101', '4W', 'A+',  'Arjun Sharma'],      // Microsoft
  ['5248002', 'TS07CD5678', 'MSF-102', '2W', 'O+',  'Priya Krishnan'],    // Microsoft
  ['5248003', 'TS10EF9012', 'MSF-103', '4W', 'B+',  'Rahul Mehta'],       // Microsoft
  ['5248004', 'TS08GH3456', 'GGL-201', '2W', 'AB+', 'Sneha Patel'],       // Google
  ['5248005', 'TS11IJ7890', 'GGL-202', '4W', 'A-',  'Vikash Kumar'],      // Google
  ['5248006', 'TS09KL2345', 'GGL-203', '2W', 'O-',  'Anjali Nair'],       // Google
  ['5248007', 'TS07MN6789', 'AMZ-301', '4W', 'B-',  'Suresh Reddy'],      // Amazon
  ['5248008', 'TS10OP0123', 'AMZ-302', '2W', 'O+',  'Meera Iyer'],        // Amazon
  ['5248009', 'TS08QR4567', 'AMZ-303', '4W', 'A+',  'Karthik Rao'],       // Amazon
  ['5248010', 'TS11ST8901', 'INF-401', '2W', 'B+',  'Deepika Singh'],     // Infosys
  ['5248011', 'TS09UV2345', 'INF-402', '4W', 'A+',  'Arun Babu'],         // Infosys
  ['5248012', 'TS07WX6789', 'INF-403', '2W', 'O+',  'Lavanya Gupta'],     // Infosys
  ['5248013', 'TS10YZ0123', 'WIP-501', '4W', 'B+',  'Ramesh Verma'],      // Wipro
  ['5248014', 'TS08AB4567', 'WIP-502', '4W', 'AB-', 'Sunita Joshi'],      // Wipro
  ['5248015', 'TS11CD8901', 'WIP-503', '2W', 'A+',  'Harish Pillai'],     // Wipro
  ['5248016', 'TS09EF2345', 'TCS-601', '4W', 'O+',  'Pooja Agarwal'],     // TCS
  ['5248017', 'TS07GH6789', 'TCS-602', '2W', 'B+',  'Naveen Teja'],       // TCS
  ['5248018', 'TS10IJ0123', 'TCS-603', '4W', 'A-',  'Shruthi Rao'],       // TCS
  ['5248019', 'TS08KL4567', 'TM-701',  '2W', 'O+',  'Manoj Kumar'],       // Tech Mahindra
  ['5248020', 'TS11MN8901', 'TM-702',  '4W', 'B+',  'Divya Shetty'],      // Tech Mahindra
  ['5248021', 'TS09OP2345', 'COG-801', '2W', 'A+',  'Ravi Prakash'],      // Cognizant
  ['5248022', 'TS07QR6789', 'COG-802', '4W', 'O+',  'Lakshmi Devi'],      // Cognizant
  ['5248023', 'TS10ST0123', 'DEL-901', '2W', 'B+',  'Sanjay Nair'],       // Deloitte
  ['5248024', 'TS08UV4567', 'DEL-902', '4W', 'A+',  'Kavya Menon'],       // Deloitte
  ['5248025', 'TS11WX8901', 'JPM-001', '2W', 'O+',  'Anand Venkat'],      // JP Morgan
];

// Unauthorized visitor cards (not registered)
const UNAUTH = [
  { cardId: '5248531', vehicleType: '4W' },
  { cardId: '5248532', vehicleType: '2W' },
  { cardId: '5248533', vehicleType: '4W' },
  { cardId: '5248534', vehicleType: '4W' },
  { cardId: '5248535', vehicleType: '2W' },
  { cardId: '5248536', vehicleType: '4W' },
  { cardId: '5248537', vehicleType: '2W' },
  { cardId: '5248538', vehicleType: '4W' },
];

// Unauthorized visit time patterns: [entryH, entryM, exitH, exitM, entryGate, exitGate]
const UNAUTH_PATTERNS = [
  [ 9, 15, 10, 30, 1, 1],  // morning   – enters & exits Gate 1
  [11, 45, 13,  0, 2, 2],  // late AM   – enters & exits Gate 2
  [14, 20, 15, 40, 1, 2],  // afternoon – enters Gate 1, exits Gate 2
  [10,  0, 11, 15, 2, 1],  // mid AM    – enters Gate 2, exits Gate 1
  [16, 10, 17, 20, 1, 1],  // late PM   – enters & exits Gate 1
  [13,  5, 14, 30, 2, 2],  // midday    – enters & exits Gate 2
];

// Cards that entered on May 18 and never exited → overstay on May 19
const OVERSTAY_CARDS = new Set(['5248003', '5248011', '5248017']);

// ─── Authorized Vehicles for Config/API ──────────────────────────────────────

export const DUMMY_AUTHORIZED_VEHICLES = VDEFS.map(([cardId, pname, flatNum, vehicleType, bloodGroup, ownerName]) => ({
  CardData: cardId,
  PName: pname,
  CarNumber: ownerName || '',
  flatNumber: flatNum,
  vehicleType,
  BloodGroup: bloodGroup,
  Authorization: 'Active',
}));

// ─── Parking Allocations (all 25 authorized vehicles have slots) ─────────────

// Maps company flat-number prefix → { full name, total parking slots }
const COMPANY_PARKING_INFO = {
  MSF: { name: 'Microsoft India',                slots: 22 },
  GGL: { name: 'Google India',                   slots: 20 },
  AMZ: { name: 'Amazon India',                   slots: 25 },
  INF: { name: 'Infosys Ltd',                    slots: 18 },
  WIP: { name: 'Wipro Technologies',             slots: 15 },
  TCS: { name: 'Tata Consultancy Services',      slots: 20 },
  TM:  { name: 'Tech Mahindra',                  slots: 15 },
  COG: { name: 'Cognizant Technology Solutions', slots: 16 },
  DEL: { name: 'Deloitte India',                 slots: 12 },
  JPM: { name: 'JP Morgan Services India',       slots: 10 },
};

// Track sequential slot number per company (e.g. first TM vehicle → PS-1, second → PS-2)
const _companySlotCounter = {};

export const DUMMY_PARKING_ALLOCATIONS = VDEFS.map(([cardId, pname, flatNum, vehicleType]) => {
  const prefix  = flatNum.split('-')[0];
  const info    = COMPANY_PARKING_INFO[prefix];
  _companySlotCounter[prefix] = (_companySlotCounter[prefix] || 0) + 1;
  const slotNum = _companySlotCounter[prefix];
  const parkingSpace = info
    ? `${info.name} PS-${slotNum}/${info.slots}`
    : 'No Slot Assigned';
  return {
    cardId,
    vehicleNo: pname,
    companyName: info?.name || flatNum,
    vehicleType,
    parkingSpace,
    remark: '',
    allottedAt: buildTS(30, 9, 0),
  };
});

// ─── Live Records Generator ───────────────────────────────────────────────────

function isActiveToday(vIdx) {
  return ((vIdx * 7) % 10) < 7;
}

function isActiveOnDay(vIdx, daysBack) {
  return ((vIdx * 7 + daysBack * 3) % 10) < 7;
}

// Gate device IDs — physical location (independent of direction)
// Gate 1 device: 14070001  |  Gate 2 device: 24074151
// Direction comes from PortNum: 1=entry, 2=exit
function gateEqupt(gateNum, portNum) {
  const device = gateNum === 2 ? '24074151' : '14070001';
  return `${device} - ${portNum}`;
}

function generateLiveRecords() {
  const records = [];
  let id = 100001;

  for (let daysBack = 29; daysBack >= 0; daysBack--) {
    const dow = getDOW(daysBack);
    if (dow === 0) continue; // closed Sundays

    const isSat = dow === 6;
    const isToday = daysBack === 0;

    // Determine which vehicles are active this day
    let active;
    if (isSat) {
      active = VDEFS.slice(0, 5).map((v, i) => ({ v, localIdx: i }));
    } else {
      active = VDEFS
        .map((v, i) => ({ v, i }))
        .filter(({ i }) => isActiveOnDay(i, daysBack))
        .slice(0, 18)
        .map(({ v }, localIdx) => ({ v, localIdx }));
    }

    active.forEach(({ v, localIdx }) => {
      const [cardId, pname, flatNum, vehicleType, , ownerName] = v;

      // Distribute vehicles across both gates realistically:
      //   localIdx % 3 === 0 → enters Gate 1, exits Gate 2  (standard)
      //   localIdx % 3 === 1 → enters Gate 1, exits Gate 1  (loop back)
      //   localIdx % 3 === 2 → enters Gate 2, exits Gate 2  (uses side entrance)
      const entryGate = (localIdx % 3 === 2) ? 2 : 1;
      const exitGate  = (localIdx % 3 === 1) ? 1 : 2;

      // Entry: stagger 6 min apart starting 08:30
      const eTotal = 8 * 60 + 30 + localIdx * 6;
      const eH = Math.floor(eTotal / 60);
      const eM = eTotal % 60;

      records.push({
        CardRecordID: id++,
        CardData: cardId,
        PName: pname,
        CarNumber: ownerName || '',
        flatNumber: flatNum,
        vehicleType,
        PCode: flatNum,
        EquptName: gateEqupt(entryGate, 1),
        PortNum: 1,
        ScanTime: buildTS(daysBack, eH, eM),
      });

      // Exit: skip overstay cards on May 18; today only non-multiples-of-3 exit
      const isOverstayDay = daysBack === 1 && OVERSTAY_CARDS.has(cardId);
      const noExitToday = isToday && (localIdx % 3 === 0);
      const shouldExit = !isOverstayDay && !noExitToday;

      if (shouldExit) {
        const xTotal = 17 * 60 + 30 + localIdx * 7;
        const xH = Math.floor(xTotal / 60);
        const xM = xTotal % 60;

        records.push({
          CardRecordID: id++,
          CardData: cardId,
          PName: pname,
          CarNumber: ownerName || '',
          flatNumber: flatNum,
          vehicleType,
          PCode: flatNum,
          EquptName: gateEqupt(exitGate, 2),
          PortNum: 2,
          ScanTime: buildTS(daysBack, xH, xM),
        });
      }
    });

    // Unauthorized visitors: 2 per weekday, 1 on Saturday
    {
      const unauthPerDay = isSat ? 1 : 2;
      for (let vi = 0; vi < unauthPerDay; vi++) {
        const u = UNAUTH[(daysBack * 2 + vi) % UNAUTH.length];
        const [eH, eM, xH, xM, entryGate, exitGate] = UNAUTH_PATTERNS[(daysBack + vi * 3) % UNAUTH_PATTERNS.length];

        // Entry scan — always recorded
        records.push({
          CardRecordID: id++,
          CardData: u.cardId,
          PName: '-',
          CarNumber: '',
          flatNumber: '',
          vehicleType: u.vehicleType,
          PCode: '',
          EquptName: gateEqupt(entryGate, 1),
          PortNum: 1,
          ScanTime: buildTS(daysBack, eH, eM),
        });

        // Exit scan — always exit except today's last unauthorized visit (still inside)
        const isStillInside = daysBack === 0 && vi === unauthPerDay - 1;
        if (!isStillInside) {
          records.push({
            CardRecordID: id++,
            CardData: u.cardId,
            PName: '-',
            CarNumber: '',
            flatNumber: '',
            vehicleType: u.vehicleType,
            PCode: '',
            EquptName: gateEqupt(exitGate, 2),
            PortNum: 2,
            ScanTime: buildTS(daysBack, xH, xM),
          });
        }
      }
    }
  }

  return records;
}

export const DUMMY_LIVE_RECORDS = generateLiveRecords();

// ─── Vehicle Count Stats (computed from actual records) ──────────────────────

function dateStr(daysBack) {
  const d = new Date(2026, 4, 19);
  d.setDate(d.getDate() - daysBack);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function computeCountStats(records, fromDate, toDate) {
  let entry = 0, exit = 0;
  let twoWheelerEntry = 0, twoWheelerExit = 0;
  let fourWheelerEntry = 0, fourWheelerExit = 0;

  for (const r of records) {
    if (!r.ScanTime) continue;
    const d = r.ScanTime.slice(0, 10);
    if (d < fromDate || d > toDate) continue;
    const isEntry = r.PortNum === 1;
    const is2W = r.vehicleType === '2W';
    const is4W = r.vehicleType === '4W';
    if (isEntry) {
      entry++;
      if (is2W) twoWheelerEntry++;
      else if (is4W) fourWheelerEntry++;
    } else {
      exit++;
      if (is2W) twoWheelerExit++;
      else if (is4W) fourWheelerExit++;
    }
  }
  // total = entry count so that: 2-Wheelers + 4-Wheelers = total (all verifiable)
  return {
    total: entry,
    entry,
    exit,
    twoWheeler: twoWheelerEntry,
    fourWheeler: fourWheelerEntry,
    twoWheelerEntry, twoWheelerExit,
    fourWheelerEntry, fourWheelerExit,
  };
}

const TODAY_STR   = dateStr(0);
const WEEK_START  = dateStr(6);
const MONTH_START = dateStr(29);

export const DUMMY_VEHICLE_COUNT = {
  data: {
    day:   computeCountStats(DUMMY_LIVE_RECORDS, TODAY_STR, TODAY_STR),
    week:  computeCountStats(DUMMY_LIVE_RECORDS, WEEK_START, TODAY_STR),
    month: computeCountStats(DUMMY_LIVE_RECORDS, MONTH_START, TODAY_STR),
  },
};

// ─── Vehicle Stats for Chart ──────────────────────────────────────────────────

function dayStats() {
  // Hourly buckets 0-23; peaks at entry 8-10, exit 17-19
  return Array.from({ length: 24 }, (_, h) => {
    const eW = h >= 8 && h <= 10 ? [4, 5, 3][h - 8] || 1 : h >= 11 && h <= 14 ? 1 : 0;
    const xW = h >= 17 && h <= 19 ? [3, 5, 4][h - 17] || 1 : 0;
    return {
      hour: h,
      entry: eW * 2 + eW * 3,
      exit: xW * 2 + xW * 3,
      twoWheelerEntry: eW * 2,
      twoWheelerExit: xW * 2,
      fourWheelerEntry: eW * 3,
      fourWheelerExit: xW * 3,
    };
  });
}

function weekStats() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(2026, 4, 19);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    const wkend = dow === 0 || dow === 6;
    const e2 = wkend ? 1 : 7; const x2 = wkend ? 0 : 6;
    const e4 = wkend ? 1 : 9; const x4 = wkend ? 0 : 8;
    out.push({
      day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      entry: e2 + e4, exit: x2 + x4,
      twoWheelerEntry: e2, twoWheelerExit: x2,
      fourWheelerEntry: e4, fourWheelerExit: x4,
    });
  }
  return out;
}

// Deterministic "variance" using day index
function dv(i) { return [0, 1, -1, 2, 0, -1, 1, 2, -1, 0][i % 10]; }

function monthStats() {
  const out = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(2026, 4, 19);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    const wkend = dow === 0 || dow === 6;
    const e2 = wkend ? 1 : Math.max(4, 7 + dv(i));
    const x2 = wkend ? 0 : Math.max(3, 6 + dv(i + 1));
    const e4 = wkend ? 1 : Math.max(5, 9 + dv(i + 2));
    const x4 = wkend ? 0 : Math.max(4, 8 + dv(i + 3));
    out.push({
      day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      entry: e2 + e4, exit: x2 + x4,
      twoWheelerEntry: e2, twoWheelerExit: x2,
      fourWheelerEntry: e4, fourWheelerExit: x4,
    });
  }
  return out;
}

export function getDummyVehicleStats(period) {
  if (period === 'day') return dayStats();
  if (period === 'week') return weekStats();
  return monthStats();
}

// ─── Vehicle Type Count (donut chart / stats) ────────────────────────────────

const _month = DUMMY_VEHICLE_COUNT.data.month;
export const DUMMY_VEHICLE_TYPE_COUNT = {
  total: _month.total,
  twoWheeler: _month.twoWheeler,
  fourWheeler: _month.fourWheeler,
};

// ─── Occupancy ────────────────────────────────────────────────────────────────

// Today's active vehicles that haven't exited (localIdx % 3 === 0)
const todayActiveVdefs = VDEFS
  .map((v, i) => ({ v, i }))
  .filter(({ i }) => isActiveToday(i))
  .slice(0, 18)
  .map(({ v }, localIdx) => ({ v, localIdx }))
  .filter(({ localIdx }) => localIdx % 3 === 0);

const stillInsideRecords = todayActiveVdefs.map(({ v, localIdx }) => {
  const [cardId, pname, flatNum, vt] = v;
  const eTotal = 8 * 60 + 30 + localIdx * 6;
  return {
    CardData: cardId,
    PName: pname,
    EntryTime: buildTS(0, Math.floor(eTotal / 60), eTotal % 60),
    ExitTime: null,
    VehicleType: vt,
    PCode: flatNum,
  };
});

const overstayRecords = VDEFS
  .filter(([cardId]) => OVERSTAY_CARDS.has(cardId))
  .map(([cardId, pname, flatNum, vt]) => ({
    CardData: cardId,
    PName: pname,
    EntryTime: buildTS(1, 8, 45),
    ExitTime: null,
    VehicleType: vt,
    PCode: flatNum,
  }));

export const DUMMY_OCCUPANCY_SUMMARY = {
  insideCount: stillInsideRecords.length + overstayRecords.length,
  overstayCount: overstayRecords.length,
  outsideCount: Math.max(0, 25 - stillInsideRecords.length - overstayRecords.length),
};

export function getDummyOccupancyRecords(status) {
  if (status === 'overstay') return overstayRecords;
  if (status === 'inside') return [...stillInsideRecords, ...overstayRecords];
  // outside
  const insideIds = new Set([...stillInsideRecords, ...overstayRecords].map(r => r.CardData));
  return DUMMY_AUTHORIZED_VEHICLES
    .filter(v => !insideIds.has(v.CardData))
    .map(v => ({
      CardData: v.CardData,
      PName: v.PName,
      EntryTime: buildTS(1, 8, 30),
      ExitTime: buildTS(1, 18, 30),
      VehicleType: v.vehicleType,
      PCode: v.flatNumber,
    }));
}

// ─── Report Sessions ──────────────────────────────────────────────────────────

function generateReportSessions() {
  const sessions = [];

  for (let daysBack = 29; daysBack >= 0; daysBack--) {
    const dow = getDOW(daysBack);
    if (dow === 0) continue;

    const isSat = dow === 6;
    const isToday = daysBack === 0;

    const active = isSat
      ? VDEFS.slice(0, 5).map((v, localIdx) => ({ v, localIdx }))
      : VDEFS
          .map((v, i) => ({ v, i }))
          .filter(({ i }) => isActiveOnDay(i, daysBack))
          .slice(0, 18)
          .map(({ v }, localIdx) => ({ v, localIdx }));

    active.forEach(({ v, localIdx }) => {
      const [cardId, pname, flatNum, vehicleType] = v;

      const eTotal = 8 * 60 + 30 + localIdx * 6;
      const eH = Math.floor(eTotal / 60);
      const eM = eTotal % 60;

      const xTotal = 17 * 60 + 30 + localIdx * 7;
      const xH = Math.floor(xTotal / 60);
      const xM = xTotal % 60;

      const isOverstayDay = daysBack === 1 && OVERSTAY_CARDS.has(cardId);
      const noExitToday = isToday && (localIdx % 3 === 0);
      const stillInside = isOverstayDay || noExitToday;

      sessions.push({
        CardData: cardId,
        PName: pname,
        Addr: flatNum,
        Authorization: 'Authorized',
        VehicleType: vehicleType === '2W' ? '2-Wheeler' : '4-Wheeler',
        EntryTime: buildTS(daysBack, eH, eM),
        ExitTime: stillInside ? null : buildTS(daysBack, xH, xM),
        Status: stillInside ? 'Still Inside' : 'Exited',
        PCode: flatNum,
      });
    });

    // Unauthorized sessions: 2 per weekday, 1 on Saturday (mirrors live records)
    {
      const unauthPerDay = isSat ? 1 : 2;
      for (let vi = 0; vi < unauthPerDay; vi++) {
        const u = UNAUTH[(daysBack * 2 + vi) % UNAUTH.length];
        const [eH, eM, xH, xM] = UNAUTH_PATTERNS[(daysBack + vi * 3) % UNAUTH_PATTERNS.length];
        const isStillInside = daysBack === 0 && vi === unauthPerDay - 1;
        const vType = u.vehicleType === '4W' ? '4-Wheeler' : u.vehicleType === '2W' ? '2-Wheeler' : '-';
        sessions.push({
          CardData: u.cardId,
          PName: '-',
          Addr: '-',
          Authorization: 'Unauthorized',
          VehicleType: vType,
          EntryTime: buildTS(daysBack, eH, eM),
          ExitTime: isStillInside ? null : buildTS(daysBack, xH, xM),
          Status: isStillInside ? 'Still Inside' : 'Exited',
          PCode: '',
        });
      }
    }
  }

  // Sort descending by entry time
  sessions.sort((a, b) => (b.EntryTime || '').localeCompare(a.EntryTime || ''));
  return sessions;
}

export const DUMMY_REPORT_SESSIONS = generateReportSessions();

// ─── 24h Alert Data ───────────────────────────────────────────────────────────

export const DUMMY_24H_ALERT = overstayRecords.map(r => ({
  cardId: r.CardData,
  name: r.PName,
  flat: VDEFS.find(([id]) => id === r.CardData)?.[2] || '-',
  entryTime: r.EntryTime,
  hours: 27,
}));

// ─── Dummy Local Approvals (reasons for allowed unauthorized vehicles) ────────

export const DUMMY_LOCAL_APPROVALS = {
  '5248531': { cardId: '5248531', vehicleNo: 'TS09PQ1234', companyName: '', remark: 'Emergency maintenance vehicle - approved by facility manager', allowedAt: '2026-05-15T10:30:00' },
  '5248532': { cardId: '5248532', vehicleNo: 'TS07AB5678', companyName: '', remark: 'Courier delivery for office supplies', allowedAt: '2026-05-16T11:00:00' },
  '5248533': { cardId: '5248533', vehicleNo: 'TS11CD9012', companyName: '', remark: 'Vendor access - IT equipment installation', allowedAt: '2026-05-17T09:15:00' },
  '5248534': { cardId: '5248534', vehicleNo: 'TS08EF3456', companyName: '', remark: 'Client visit - pre-approved by sales team', allowedAt: '2026-05-17T14:20:00' },
  '5248535': { cardId: '5248535', vehicleNo: 'TS10GH7890', companyName: '', remark: 'Temporary contractor - civil work permit', allowedAt: '2026-05-18T08:45:00' },
  '5248536': { cardId: '5248536', vehicleNo: 'TS07IJ2345', companyName: '', remark: 'Canteen supply delivery vehicle', allowedAt: '2026-05-18T13:05:00' },
  '5248537': { cardId: '5248537', vehicleNo: 'TS09KL6789', companyName: '', remark: 'Visitor pass - interview candidate', allowedAt: '2026-05-19T09:30:00' },
  '5248538': { cardId: '5248538', vehicleNo: 'TS11MN0123', companyName: '', remark: 'Security audit team - management approval', allowedAt: '2026-05-19T10:00:00' },
};

// ─── LocalStorage Initialiser ─────────────────────────────────────────────────

export function initDummyLocalStorage() {
  // Always ensure all 10 dummy companies are present; keep any user-added ones on top
  try {
    const stored = localStorage.getItem('registeredCompanies');
    const existing = stored ? JSON.parse(stored) : [];
    const dummyIds = new Set(DUMMY_COMPANIES.map((c) => c.id));
    const userAdded = Array.isArray(existing) ? existing.filter((c) => !dummyIds.has(c.id)) : [];
    localStorage.setItem('registeredCompanies', JSON.stringify([...DUMMY_COMPANIES, ...userAdded]));
  } catch {
    localStorage.setItem('registeredCompanies', JSON.stringify(DUMMY_COMPANIES));
  }

  // Always reset live entry/exit records to dummy data — clears stale accumulated records
  try {
    localStorage.setItem('vehicleAccess.entryExitRecords.v1', JSON.stringify(DUMMY_LIVE_RECORDS));
  } catch {
    // ignore quota errors
  }

  // Always reset parking allocations so old physical-slot format (P-A101) is replaced
  // with the new readable format (CompanyName PS-N/Total)
  try {
    const stored = localStorage.getItem('vehicleAccess.parkingAllocations.v1');
    const parsed = stored ? JSON.parse(stored) : null;
    // Detect stale format: old P-A101 style, old company names, or incomplete allocation (< 25 entries)
    const space0 = Array.isArray(parsed) && parsed.length > 0 ? String(parsed[0].parkingSpace || '') : '';
    const isStaleFormat = /^P-[A-Z]/.test(space0) || /^TechMahindra|^Infosys Technologies|^Wipro Ltd|^HCL|^Accenture|^Capgemini|^IBM India|^Deloitte Consulting/.test(space0);
    const isIncomplete = Array.isArray(parsed) && parsed.length < DUMMY_PARKING_ALLOCATIONS.length;
    if (!Array.isArray(parsed) || parsed.length === 0 || isStaleFormat || isIncomplete) {
      localStorage.setItem('vehicleAccess.parkingAllocations.v1', JSON.stringify(DUMMY_PARKING_ALLOCATIONS));
    }
  } catch {
    localStorage.setItem('vehicleAccess.parkingAllocations.v1', JSON.stringify(DUMMY_PARKING_ALLOCATIONS));
  }

  // Seed local approvals (reasons for allowed unauthorized vehicles) only if none exist
  try {
    if (!localStorage.getItem('vehicleAccess.localApprovals.v1')) {
      localStorage.setItem('vehicleAccess.localApprovals.v1', JSON.stringify(DUMMY_LOCAL_APPROVALS));
    }
  } catch {
    // ignore
  }
}
