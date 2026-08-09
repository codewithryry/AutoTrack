import * as db from '../services/db'
import { COLLECTIONS } from '../services/db'
import { buildCredentials } from '../services/users'
import { buildQRPayload } from '../utils/qr'
import { generateTxnId, padId, uid } from '../utils/helpers'
import { addDaysISO, nowISO } from '../utils/dates'
import {
  ACTIVITY,
  CONDITION,
  DEFAULT_SETTINGS,
  MAINTENANCE_STATUS,
  NOTIF_TYPE,
  ROLE,
  TOOL_STATUS,
  TXN_STATUS,
  USER_STATUS,
} from '../utils/constants'

/**
 * First-run demo data for an automotive laboratory.
 *
 * Dates are generated relative to today so the dashboard always looks live:
 * there are loans due tomorrow, loans already overdue, returns from last week
 * and maintenance scheduled for next month, no matter when the app is opened.
 */

/* ------------------------------------------------------------------ *
 * Tools — 32 records across the automotive categories
 * ------------------------------------------------------------------ */

const TOOL_CATALOG = [
  // Hand tools
  { name: 'Combination Wrench Set 8–24mm', category: 'Hand Tools', brand: 'Stanley', model: 'STMT80943', location: 'Tool Room Shelf A', condition: CONDITION.GOOD, description: '14-piece metric combination wrench set for general engine work.' },
  { name: 'Combination Wrench 14mm', category: 'Hand Tools', brand: 'Sata', model: 'SA40208', location: 'Tool Room Shelf A', condition: CONDITION.GOOD, description: 'Single 14mm combination wrench, chrome vanadium.' },
  { name: 'Socket Set 1/2" Drive', category: 'Hand Tools', brand: 'Tekton', model: 'SKT15301', location: 'Tool Room Shelf A', condition: CONDITION.EXCELLENT, description: '24-piece 1/2 inch drive socket set, 10–32mm.' },
  { name: 'Socket Set 3/8" Drive', category: 'Hand Tools', brand: 'Tekton', model: 'SKT13401', location: 'Tool Room Shelf B', condition: CONDITION.GOOD, description: '20-piece 3/8 inch drive socket set for tight engine bays.' },
  { name: 'Ratchet Handle 1/2"', category: 'Hand Tools', brand: 'Sata', model: 'SA13903', location: 'Tool Room Shelf A', condition: CONDITION.GOOD, description: '72-tooth reversible ratchet handle.' },
  { name: 'Screwdriver Set (12-piece)', category: 'Hand Tools', brand: 'Bosch', model: 'BSD12PC', location: 'Tool Room Shelf B', condition: CONDITION.FAIR, description: 'Flat and Phillips screwdrivers with insulated grips.' },
  { name: 'Combination Pliers 200mm', category: 'Hand Tools', brand: 'Knipex', model: 'KN0301200', location: 'Tool Room Shelf B', condition: CONDITION.GOOD, description: 'General purpose combination pliers.' },
  { name: 'Long Nose Pliers 160mm', category: 'Hand Tools', brand: 'Knipex', model: 'KN2501160', location: 'Tool Room Shelf B', condition: CONDITION.GOOD, description: 'Long nose pliers for wiring harness work.' },
  { name: 'Allen Key Set (Metric)', category: 'Hand Tools', brand: 'Bondhus', model: 'BND12299', location: 'Tool Room Shelf C', condition: CONDITION.GOOD, description: '9-piece ball-end hex key set, 1.5–10mm.' },
  { name: 'Adjustable Wrench 12"', category: 'Hand Tools', brand: 'Stanley', model: 'STMT87434', location: 'Tool Room Shelf C', condition: CONDITION.FAIR, description: '300mm adjustable wrench with wide jaw capacity.' },
  { name: 'Ball Peen Hammer 16oz', category: 'Hand Tools', brand: 'Stanley', model: 'STHT54193', location: 'Tool Room Shelf C', condition: CONDITION.GOOD, description: 'Forged steel ball peen hammer with hickory handle.' },
  { name: 'Rubber Mallet 24oz', category: 'Hand Tools', brand: 'Truper', model: 'TRP19923', location: 'Tool Room Shelf C', condition: CONDITION.GOOD, description: 'Non-marring mallet for panel and bearing work.' },

  // Power tools
  { name: 'Cordless Impact Wrench 1/2"', category: 'Power Tools', brand: 'Makita', model: 'DTW285Z', location: 'Engine Bay Cabinet A', condition: CONDITION.EXCELLENT, description: '18V brushless impact wrench, 280 Nm fastening torque.', serial: 'MKT-DTW-88214' },
  { name: 'Cordless Drill Driver', category: 'Power Tools', brand: 'DeWalt', model: 'DCD771C2', location: 'Engine Bay Cabinet A', condition: CONDITION.GOOD, description: '20V compact drill driver with two batteries.', serial: 'DWT-DCD-40217' },
  { name: 'Angle Grinder 4"', category: 'Power Tools', brand: 'Bosch', model: 'GWS 900-100', location: 'Engine Bay Cabinet B', condition: CONDITION.GOOD, description: '900W angle grinder for exhaust and bracket work.', serial: 'BSH-GWS-55190' },

  // Measuring tools
  { name: 'Torque Wrench 1/2" 28–210 Nm', category: 'Measuring Tools', brand: 'Norbar', model: 'NOR15005', location: 'Tool Room Shelf A', condition: CONDITION.EXCELLENT, description: 'Click-type torque wrench, calibrated for cylinder head work.', serial: 'NOR-TW-11204' },
  { name: 'Torque Wrench 3/8" 5–60 Nm', category: 'Measuring Tools', brand: 'Norbar', model: 'NOR13840', location: 'Tool Room Shelf A', condition: CONDITION.GOOD, description: 'Low-range torque wrench for sensors and covers.', serial: 'NOR-TW-11311' },
  { name: 'Vernier Caliper 150mm', category: 'Measuring Tools', brand: 'Mitutoyo', model: '530-312', location: 'Diagnostic Room', condition: CONDITION.EXCELLENT, description: 'Dial vernier caliper, 0.02mm resolution.', serial: 'MTY-VC-70233' },
  { name: 'Outside Micrometer 0–25mm', category: 'Measuring Tools', brand: 'Mitutoyo', model: '103-137', location: 'Diagnostic Room', condition: CONDITION.EXCELLENT, description: 'Precision micrometer for piston and journal measurement.', serial: 'MTY-MM-70418' },
  { name: 'Feeler Gauge Set', category: 'Measuring Tools', brand: 'Mitutoyo', model: '184-303S', location: 'Diagnostic Room', condition: CONDITION.GOOD, description: '32-blade feeler gauge, 0.04–0.88mm, for valve clearance.' },
  { name: 'Torque Angle Gauge', category: 'Measuring Tools', brand: 'Sealey', model: 'AK9683', location: 'Tool Room Shelf A', condition: CONDITION.GOOD, description: 'Torque-to-yield angle gauge for head bolt sequences.' },
  { name: 'Dial Indicator with Magnetic Base', category: 'Measuring Tools', brand: 'Mitutoyo', model: '2046S', location: 'Diagnostic Room', condition: CONDITION.GOOD, description: 'Runout and end-float measurement set.', serial: 'MTY-DI-70562' },

  // Diagnostic tools
  { name: 'OBD-II Scan Tool', category: 'Diagnostic Tools', brand: 'Autel', model: 'MaxiCOM MK808', location: 'Diagnostic Room', condition: CONDITION.EXCELLENT, description: 'Full-system diagnostic scanner with live data and service resets.', serial: 'AUT-MK808-30172' },
  { name: 'Compression Tester Kit', category: 'Diagnostic Tools', brand: 'OTC', model: 'OTC5605', location: 'Diagnostic Room', condition: CONDITION.GOOD, description: 'Petrol engine compression test kit with adapters.', serial: 'OTC-CT-22087' },
  { name: 'Fuel Pressure Test Kit', category: 'Diagnostic Tools', brand: 'Mityvac', model: 'MV5535', location: 'Diagnostic Room', condition: CONDITION.GOOD, description: 'Fuel system pressure gauge with adapter set.', serial: 'MTV-FP-19045' },
  { name: 'Cooling System Pressure Tester', category: 'Diagnostic Tools', brand: 'Stant', model: 'STA12270', location: 'Engine Bay Cabinet B', condition: CONDITION.FAIR, description: 'Radiator and cap pressure tester.' },

  // Electrical
  { name: 'Digital Multimeter', category: 'Electrical Tools', brand: 'Fluke', model: '117', location: 'Electrical Laboratory', condition: CONDITION.EXCELLENT, description: 'True-RMS multimeter with non-contact voltage detection.', serial: 'FLK-117-60231' },
  { name: 'Automotive Test Light', category: 'Electrical Tools', brand: 'Power Probe', model: 'PPTL01', location: 'Electrical Laboratory', condition: CONDITION.GOOD, description: '6–24V circuit test light with piercing probe.' },
  { name: 'Battery Load Tester', category: 'Electrical Tools', brand: 'Schumacher', model: 'BT-100', location: 'Electrical Laboratory', condition: CONDITION.GOOD, description: '100A carbon-pile battery and charging system tester.', serial: 'SCH-BT-44120' },
  { name: 'Wire Crimping Tool Set', category: 'Electrical Tools', brand: 'Klein Tools', model: 'K1412', location: 'Electrical Laboratory', condition: CONDITION.GOOD, description: 'Ratcheting crimper with insulated terminal dies.' },

  // Engine / brake / suspension / transmission
  { name: 'Engine Timing Tool Set', category: 'Engine Tools', brand: 'Laser Tools', model: 'LAS4899', location: 'Engine Bay Cabinet A', condition: CONDITION.GOOD, description: 'Camshaft and crankshaft locking tools for common engines.' },
  { name: 'Bearing Puller Set', category: 'Engine Tools', brand: 'Sealey', model: 'PS983', location: 'Engine Bay Cabinet B', condition: CONDITION.FAIR, description: '2 and 3-jaw bearing and gear puller set.' },
  { name: 'Valve Spring Compressor', category: 'Engine Tools', brand: 'Sealey', model: 'VS1621', location: 'Engine Bay Cabinet A', condition: CONDITION.GOOD, description: 'Overhead valve spring compressor for cylinder head service.' },
  { name: 'Brake Bleeder Kit', category: 'Brake Tools', brand: 'Mityvac', model: 'MV8000', location: 'Brake System Cabinet', condition: CONDITION.GOOD, description: 'Vacuum brake bleeding kit with reservoir.' },
  { name: 'Brake Caliper Piston Tool', category: 'Brake Tools', brand: 'Laser Tools', model: 'LAS0202', location: 'Brake System Cabinet', condition: CONDITION.GOOD, description: 'Piston rewind tool for rear caliper service.' },
  { name: 'Brake Drum Puller', category: 'Brake Tools', brand: 'Sealey', model: 'VS007', location: 'Brake System Cabinet', condition: CONDITION.FAIR, description: 'Slide hammer drum puller.' },
  { name: 'Coil Spring Compressor', category: 'Suspension Tools', brand: 'Sealey', model: 'RE231', location: 'Suspension Bay', condition: CONDITION.GOOD, description: 'MacPherson strut spring compressor pair.' },
  { name: 'Ball Joint Separator', category: 'Suspension Tools', brand: 'Laser Tools', model: 'LAS1723', location: 'Suspension Bay', condition: CONDITION.GOOD, description: 'Universal ball joint and tie rod separator.' },
  { name: 'Clutch Alignment Tool Set', category: 'Transmission Tools', brand: 'Sealey', model: 'VS002', location: 'Transmission Bench', condition: CONDITION.GOOD, description: 'Universal clutch plate alignment set.' },
  { name: 'Hydraulic Floor Jack 2 Ton', category: 'Safety Equipment', brand: 'Torin', model: 'T82002', location: 'Suspension Bay', condition: CONDITION.GOOD, description: 'Low-profile hydraulic trolley jack, 2 tonne capacity.', serial: 'TRN-JK-90113' },
  { name: 'Axle Stand Pair 3 Ton', category: 'Safety Equipment', brand: 'Torin', model: 'T43002A', location: 'Suspension Bay', condition: CONDITION.EXCELLENT, description: 'Ratcheting axle stands, sold and stored as a pair.' },
  { name: 'Wheel Chock Set', category: 'Safety Equipment', brand: 'Generic', model: 'WC-4R', location: 'Safety Equipment Locker', condition: CONDITION.GOOD, description: 'Rubber wheel chocks for lifting operations.' },
]

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

const USER_CATALOG = [
  { fullName: 'Ramon L. Villanueva', username: 'admin', password: 'admin123', role: ROLE.ADMIN, email: 'r.villanueva@autolab.edu.ph', contact: '0917 442 1180', course: '', yearLevel: 'N/A', studentId: '' },
  { fullName: 'Engr. Carlos M. Bautista', username: 'instructor', password: 'instructor123', role: ROLE.INSTRUCTOR, email: 'c.bautista@autolab.edu.ph', contact: '0918 330 7745', course: '', yearLevel: 'N/A', studentId: '' },
  { fullName: 'Juan Dela Cruz', username: 'student', password: 'student123', role: ROLE.STUDENT, email: 'j.delacruz@autolab.edu.ph', contact: '0920 118 3364', course: 'BS Automotive Engineering Technology', yearLevel: '3rd Year', studentId: '2022-04517' },
  { fullName: 'Engr. Lourdes A. Fernandez', username: 'lfernandez', password: 'instructor123', role: ROLE.INSTRUCTOR, email: 'l.fernandez@autolab.edu.ph', contact: '0917 220 4419', course: '', yearLevel: 'N/A', studentId: '' },
  { fullName: 'Maria Santos', username: 'msantos', password: 'student123', role: ROLE.STUDENT, email: 'm.santos@autolab.edu.ph', contact: '0921 776 2280', course: 'BS Automotive Engineering Technology', yearLevel: '3rd Year', studentId: '2022-04522' },
  { fullName: 'Pedro Reyes', username: 'preyes', password: 'student123', role: ROLE.STUDENT, email: 'p.reyes@autolab.edu.ph', contact: '0915 883 1027', course: 'Diploma in Automotive Technology', yearLevel: '2nd Year', studentId: '2023-01188' },
  { fullName: 'Angelo Mercado', username: 'amercado', password: 'student123', role: ROLE.STUDENT, email: 'a.mercado@autolab.edu.ph', contact: '0906 442 9931', course: 'Automotive Servicing NC II', yearLevel: '1st Year', studentId: '2024-00743' },
  { fullName: 'Kristine Joy Ocampo', username: 'kocampo', password: 'student123', role: ROLE.STUDENT, email: 'k.ocampo@autolab.edu.ph', contact: '0977 512 6640', course: 'BS Automotive Engineering Technology', yearLevel: '4th Year', studentId: '2021-03310' },
  { fullName: 'Miguel Torres', username: 'mtorres', password: 'student123', role: ROLE.STUDENT, email: 'm.torres@autolab.edu.ph', contact: '0929 604 7712', course: 'Diploma in Automotive Technology', yearLevel: '2nd Year', studentId: '2023-01204' },
  { fullName: 'Danilo Aguilar', username: 'daguilar', password: 'student123', role: ROLE.STUDENT, email: 'd.aguilar@autolab.edu.ph', contact: '0933 118 5529', course: 'Automotive Servicing NC III', yearLevel: '3rd Year', studentId: '2022-04698' },
  { fullName: 'Sofia Ramirez', username: 'sramirez', password: 'student123', role: ROLE.STUDENT, email: 's.ramirez@autolab.edu.ph', contact: '0908 337 2214', course: 'BS Mechanical Engineering', yearLevel: '2nd Year', studentId: '2023-02087' },
  { fullName: 'Noel Bautista', username: 'nbautista', password: 'student123', role: ROLE.STUDENT, email: 'n.bautista@autolab.edu.ph', contact: '0946 771 3308', course: 'Automotive Servicing NC II', yearLevel: '1st Year', studentId: '2024-00811', status: USER_STATUS.INACTIVE },
]

const PURPOSES = [
  'Engine disassembly laboratory activity',
  'Brake system service practical',
  'Electrical troubleshooting exercise',
  'Cylinder head torque sequence demonstration',
  'Suspension inspection practical',
  'Vehicle diagnostic session',
  'Valve clearance adjustment activity',
  'Charging system testing exercise',
  'Clutch replacement practical',
  'Wheel bearing service activity',
]

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

async function buildUsers() {
  const users = []
  for (let i = 0; i < USER_CATALOG.length; i++) {
    const entry = USER_CATALOG[i]
    const { salt, passwordHash } = await buildCredentials(entry.password)
    users.push({
      id: padId('USR', i + 1, 4),
      fullName: entry.fullName,
      username: entry.username,
      role: entry.role,
      studentId: entry.studentId ?? '',
      course: entry.course ?? '',
      yearLevel: entry.yearLevel ?? 'N/A',
      contact: entry.contact ?? '',
      email: entry.email ?? '',
      status: entry.status ?? USER_STATUS.ACTIVE,
      salt,
      passwordHash,
      createdAt: addDaysISO(new Date(), -(180 - i * 7)),
      updatedAt: nowISO(),
    })
  }
  return users
}

function buildTools() {
  return TOOL_CATALOG.map((entry, i) => {
    const id = padId('TOOL', i + 1)
    const purchaseOffset = -(400 - i * 9)
    const lastMaintOffset = -(120 - (i % 10) * 8)
    return {
      id,
      name: entry.name,
      category: entry.category,
      description: entry.description ?? '',
      brand: entry.brand ?? '',
      model: entry.model ?? '',
      serialNumber: entry.serial ?? '',
      qrCode: buildQRPayload(id),
      location: entry.location,
      condition: entry.condition,
      status: TOOL_STATUS.AVAILABLE,
      purchaseDate: addDaysISO(new Date(), purchaseOffset),
      lastMaintenanceDate: addDaysISO(new Date(), lastMaintOffset),
      nextMaintenanceDate: addDaysISO(new Date(), lastMaintOffset + 90),
      notes: '',
      createdAt: addDaysISO(new Date(), purchaseOffset),
      updatedAt: nowISO(),
    }
  })
}

/**
 * Transaction plan.
 *
 * `dayOffsets` are relative to today, so the seeded data always contains live
 * overdue loans, loans due tomorrow, and a history of completed returns.
 */
const TRANSACTION_PLAN = [
  // --- Open loans, still within their due date ---
  { toolIndex: 1, userIndex: 2, borrow: -1, due: 1, state: 'open' },
  { toolIndex: 15, userIndex: 4, borrow: -1, due: 2, state: 'open' },
  { toolIndex: 22, userIndex: 7, borrow: -2, due: 1, state: 'open' },
  { toolIndex: 26, userIndex: 5, borrow: 0, due: 3, state: 'open' },
  { toolIndex: 33, userIndex: 8, borrow: -1, due: 4, state: 'open' },
  { toolIndex: 12, userIndex: 3, borrow: -2, due: 2, state: 'open' },

  // --- Overdue loans ---
  { toolIndex: 5, userIndex: 6, borrow: -9, due: -4, state: 'open' },
  { toolIndex: 18, userIndex: 9, borrow: -12, due: -6, state: 'open' },
  { toolIndex: 30, userIndex: 10, borrow: -7, due: -2, state: 'open' },

  // --- Completed returns ---
  { toolIndex: 0, userIndex: 2, borrow: -20, due: -17, returned: -18, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 2, userIndex: 4, borrow: -18, due: -15, returned: -16, state: 'returned', condition: CONDITION.EXCELLENT },
  { toolIndex: 16, userIndex: 5, borrow: -16, due: -13, returned: -14, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 23, userIndex: 6, borrow: -15, due: -12, returned: -12, state: 'returned', condition: CONDITION.GOOD, late: true },
  { toolIndex: 9, userIndex: 7, borrow: -14, due: -11, returned: -11, state: 'returned', condition: CONDITION.FAIR },
  { toolIndex: 27, userIndex: 8, borrow: -30, due: -27, returned: -28, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 3, userIndex: 9, borrow: -28, due: -25, returned: -26, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 20, userIndex: 3, borrow: -25, due: -22, returned: -23, state: 'returned', condition: CONDITION.EXCELLENT },
  { toolIndex: 36, userIndex: 10, borrow: -22, due: -19, returned: -20, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 6, userIndex: 4, borrow: -45, due: -42, returned: -43, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 1, userIndex: 5, borrow: -40, due: -37, returned: -38, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 15, userIndex: 2, borrow: -38, due: -35, returned: -36, state: 'returned', condition: CONDITION.EXCELLENT },
  { toolIndex: 24, userIndex: 6, borrow: -60, due: -57, returned: -58, state: 'returned', condition: CONDITION.GOOD },
  { toolIndex: 8, userIndex: 7, borrow: -55, due: -52, returned: -53, state: 'returned', condition: CONDITION.GOOD },

  // --- Returned damaged ---
  { toolIndex: 34, userIndex: 9, borrow: -11, due: -8, returned: -9, state: 'damaged', condition: CONDITION.DAMAGED },
]

function buildTransactions(tools, users) {
  const transactions = []
  const toolPatches = new Map()
  const logs = []
  const notifs = []

  TRANSACTION_PLAN.forEach((plan, index) => {
    const tool = tools[plan.toolIndex]
    const user = users[plan.userIndex]
    if (!tool || !user) return

    const borrowDate = addDaysISO(new Date(), plan.borrow)
    const dueDate = addDaysISO(new Date(), plan.due)
    const returnDate = plan.returned != null ? addDaysISO(new Date(), plan.returned) : null
    const purpose = PURPOSES[index % PURPOSES.length]
    const issuer = users[index % 2 === 0 ? 1 : 3] // an instructor issued it

    let status = TXN_STATUS.BORROWED
    if (plan.state === 'returned') status = TXN_STATUS.RETURNED
    else if (plan.state === 'damaged') status = TXN_STATUS.DAMAGED
    else if (plan.due < 0) status = TXN_STATUS.OVERDUE

    const txn = {
      id: generateTxnId(new Date(borrowDate)),
      toolId: tool.id,
      toolName: tool.name,
      toolCategory: tool.category,
      userId: user.id,
      userName: user.fullName,
      userRole: user.role,
      borrowDate,
      dueDate,
      returnDate,
      status,
      conditionOut: tool.condition,
      conditionIn: plan.condition ?? null,
      wasOverdue: Boolean(plan.late) || (plan.state === 'open' && plan.due < 0),
      purpose,
      notes: '',
      issuedById: issuer.id,
      issuedByName: issuer.fullName,
      receivedById: returnDate ? issuer.id : null,
      receivedByName: returnDate ? issuer.fullName : null,
      createdAt: borrowDate,
      updatedAt: returnDate ?? borrowDate,
    }
    transactions.push(txn)

    logs.push({
      action: ACTIVITY.TOOL_BORROWED,
      toolId: tool.id,
      toolName: tool.name,
      userId: user.id,
      userName: user.fullName,
      transactionId: txn.id,
      message: `${user.fullName} borrowed the tool for ${purpose.toLowerCase()}.`,
      createdAt: borrowDate,
    })

    if (plan.state === 'open') {
      // The tool is still out — the overdue sweep will finish the job on load.
      toolPatches.set(tool.id, {
        status: plan.due < 0 ? TOOL_STATUS.OVERDUE : TOOL_STATUS.BORROWED,
      })
      if (plan.due < 0) {
        logs.push({
          action: ACTIVITY.TOOL_OVERDUE,
          toolId: tool.id,
          toolName: tool.name,
          userId: user.id,
          userName: user.fullName,
          transactionId: txn.id,
          message: 'Tool became overdue.',
          createdAt: addDaysISO(new Date(), plan.due + 1),
        })
        notifs.push({
          type: NOTIF_TYPE.OVERDUE,
          title: 'Tool overdue',
          message: `${tool.name} has not been returned. Borrowed by ${user.fullName}.`,
          dedupeKey: `overdue:${txn.id}`,
          toolId: tool.id,
          toolName: tool.name,
          transactionId: txn.id,
          link: `/tools/${tool.id}`,
          createdAt: addDaysISO(new Date(), plan.due + 1),
        })
      }
      // A loan already inside the warning window gets its due-soon reminder.
      if (plan.due >= 0 && plan.due <= 1) {
        notifs.push({
          type: NOTIF_TYPE.DUE_SOON,
          title: 'Tool due soon',
          message: `${tool.name} is due back on ${new Date(dueDate).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
          })}.`,
          dedupeKey: `due-soon:${txn.id}`,
          toolId: tool.id,
          toolName: tool.name,
          userId: user.id,
          transactionId: txn.id,
          link: `/tools/${tool.id}`,
          createdAt: borrowDate,
        })
      }
    } else {
      // Recent returns stay in the feed; older ones would only add noise.
      if (plan.returned != null && plan.returned >= -14 && plan.state !== 'damaged') {
        notifs.push({
          type: NOTIF_TYPE.RETURNED,
          title: 'Tool returned',
          message: `${tool.name} was successfully returned by ${user.fullName}.`,
          toolId: tool.id,
          toolName: tool.name,
          transactionId: txn.id,
          link: `/tools/${tool.id}`,
          createdAt: returnDate,
        })
      }

      logs.push({
        action: ACTIVITY.TOOL_RETURNED,
        toolId: tool.id,
        toolName: tool.name,
        userId: user.id,
        userName: user.fullName,
        transactionId: txn.id,
        message:
          plan.state === 'damaged'
            ? `Tool returned damaged by ${user.fullName} and removed from circulation.`
            : `Tool returned by ${user.fullName} in ${plan.condition} condition.`,
        createdAt: returnDate,
      })

      if (plan.condition && plan.condition !== tool.condition) {
        logs.push({
          action: ACTIVITY.CONDITION_CHANGED,
          toolId: tool.id,
          toolName: tool.name,
          userId: user.id,
          userName: user.fullName,
          transactionId: txn.id,
          message: `Condition changed from ${tool.condition} to ${plan.condition}.`,
          createdAt: returnDate,
        })
        toolPatches.set(tool.id, {
          ...(toolPatches.get(tool.id) ?? {}),
          condition: plan.condition,
        })
      }

      if (plan.state === 'damaged') {
        toolPatches.set(tool.id, {
          status: TOOL_STATUS.DAMAGED,
          condition: CONDITION.DAMAGED,
        })
        notifs.push({
          type: NOTIF_TYPE.DAMAGED,
          title: 'Damaged tool returned',
          message: `${tool.name} was returned in a damaged condition by ${user.fullName}. It has been pulled from circulation.`,
          toolId: tool.id,
          toolName: tool.name,
          transactionId: txn.id,
          link: `/tools/${tool.id}`,
          createdAt: returnDate,
        })
      }
    }
  })

  return { transactions, toolPatches, logs, notifs }
}

function buildMaintenance(tools, users) {
  const technician = 'Rolando Estrada'
  const plan = [
    { toolIndex: 15, type: 'Calibration', date: -60, next: 30, status: MAINTENANCE_STATUS.COMPLETED, cost: 1800, notes: 'Torque wrench recalibrated and certified at 28–210 Nm.' },
    { toolIndex: 16, type: 'Calibration', date: -55, next: 35, status: MAINTENANCE_STATUS.COMPLETED, cost: 1650, notes: 'Low-range torque wrench recalibrated.' },
    { toolIndex: 22, type: 'Inspection', date: -40, next: 50, status: MAINTENANCE_STATUS.COMPLETED, cost: 0, notes: 'Scan tool firmware updated, cables inspected.' },
    { toolIndex: 13, type: 'Preventive', date: -35, next: 55, status: MAINTENANCE_STATUS.COMPLETED, cost: 950, notes: 'Chuck serviced, battery contacts cleaned.' },
    { toolIndex: 25, type: 'Corrective', date: -8, next: 82, status: MAINTENANCE_STATUS.IN_PROGRESS, cost: 1200, notes: 'Pressure tester seal leaking under load — seal kit ordered.' },
    { toolIndex: 34, type: 'Corrective', date: -3, next: 87, status: MAINTENANCE_STATUS.SCHEDULED, cost: 0, notes: 'Returned damaged after a caliper service practical — rewind mechanism to be stripped and inspected.' },
    { toolIndex: 31, type: 'Cleaning', date: -20, next: 70, status: MAINTENANCE_STATUS.COMPLETED, cost: 350, notes: 'Puller set degreased and lightly oiled.' },
    { toolIndex: 39, type: 'Inspection', date: -25, next: 65, status: MAINTENANCE_STATUS.COMPLETED, cost: 0, notes: 'Hydraulic jack load-tested to 2 tonnes, no seal seepage observed.' },
    { toolIndex: 26, type: 'Calibration', date: -18, next: 72, status: MAINTENANCE_STATUS.COMPLETED, cost: 2100, notes: 'Multimeter calibration verified against reference source.' },
    { toolIndex: 18, type: 'Inspection', date: -14, next: 76, status: MAINTENANCE_STATUS.COMPLETED, cost: 0, notes: 'Micrometer anvil faces checked with optical flat.' },
    { toolIndex: 14, type: 'Parts Replacement', date: -12, next: 78, status: MAINTENANCE_STATUS.COMPLETED, cost: 780, notes: 'Grinder carbon brushes replaced.' },
  ]

  const admin = users[0]
  const records = []
  const patches = new Map()
  const logs = []

  for (const entry of plan) {
    const tool = tools[entry.toolIndex]
    if (!tool) continue
    const date = addDaysISO(new Date(), entry.date)
    const nextDate = addDaysISO(new Date(), entry.next)

    records.push({
      id: uid('MNT'),
      toolId: tool.id,
      toolName: tool.name,
      type: entry.type,
      technician,
      date,
      nextDate,
      cost: entry.cost,
      notes: entry.notes,
      status: entry.status,
      completedAt: entry.status === MAINTENANCE_STATUS.COMPLETED ? date : null,
      createdById: admin.id,
      createdByName: admin.fullName,
      createdAt: date,
      updatedAt: date,
    })

    patches.set(tool.id, {
      ...(patches.get(tool.id) ?? {}),
      lastMaintenanceDate: date,
      nextMaintenanceDate: nextDate,
    })

    // An open job keeps the tool off the floor.
    if (
      entry.status === MAINTENANCE_STATUS.SCHEDULED ||
      entry.status === MAINTENANCE_STATUS.IN_PROGRESS
    ) {
      patches.set(tool.id, { ...(patches.get(tool.id) ?? {}), status: TOOL_STATUS.MAINTENANCE })
    }

    logs.push({
      action:
        entry.status === MAINTENANCE_STATUS.COMPLETED
          ? ACTIVITY.MAINTENANCE_COMPLETED
          : ACTIVITY.MAINTENANCE_SCHEDULED,
      toolId: tool.id,
      toolName: tool.name,
      userId: admin.id,
      userName: admin.fullName,
      message:
        entry.status === MAINTENANCE_STATUS.COMPLETED
          ? `${entry.type} maintenance completed by ${technician}.`
          : `Tool sent for ${entry.type.toLowerCase()} maintenance (${technician}).`,
      createdAt: date,
    })
  }

  return { records, patches, logs }
}

function buildNotifications(extra) {
  const base = extra.map((n) => ({
    id: uid('NOTIF'),
    type: n.type,
    title: n.title,
    message: n.message,
    toolId: n.toolId ?? null,
    toolName: n.toolName ?? null,
    userId: n.userId ?? null,
    userName: n.userName ?? null,
    transactionId: n.transactionId ?? null,
    link: n.link ?? null,
    dedupeKey: n.dedupeKey ?? null,
    read: false,
    createdAt: n.createdAt ?? nowISO(),
  }))
  return base.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/** Replace everything in the database with a fresh demo laboratory. */
export async function seedDatabase() {
  const users = await buildUsers()
  const tools = buildTools()

  const { transactions, toolPatches, logs: txnLogs, notifs: txnNotifs } = buildTransactions(
    tools,
    users,
  )
  const { records: maintenanceRecords, patches: maintPatches, logs: maintLogs } = buildMaintenance(
    tools,
    users,
  )

  // Maintenance is applied first so an open job wins over an "available" tool,
  // then loan state is applied because a borrowed tool is physically out.
  const finalTools = tools.map((tool) => ({
    ...tool,
    ...(maintPatches.get(tool.id) ?? {}),
    ...(toolPatches.get(tool.id) ?? {}),
  }))

  const creationLogs = finalTools.slice(0, 6).map((tool) => ({
    action: ACTIVITY.TOOL_CREATED,
    toolId: tool.id,
    toolName: tool.name,
    userId: users[0].id,
    userName: users[0].fullName,
    message: `${tool.name} was added to the inventory (${tool.location}).`,
    createdAt: tool.createdAt,
  }))

  const activityLogs = [...creationLogs, ...txnLogs, ...maintLogs]
    .map((entry) => ({
      id: uid('LOG'),
      action: entry.action,
      toolId: entry.toolId ?? null,
      toolName: entry.toolName ?? null,
      userId: entry.userId ?? null,
      userName: entry.userName ?? 'System',
      transactionId: entry.transactionId ?? null,
      message: entry.message,
      meta: entry.meta ?? {},
      createdAt: entry.createdAt ?? nowISO(),
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const maintenanceNotifs = maintenanceRecords
    .filter((r) => r.status !== MAINTENANCE_STATUS.COMPLETED)
    .map((r) => ({
      type: NOTIF_TYPE.MAINTENANCE,
      title: 'Maintenance scheduled',
      message: `${r.toolName} is scheduled for ${r.type.toLowerCase()} maintenance.`,
      dedupeKey: `maintenance:${r.id}`,
      toolId: r.toolId,
      toolName: r.toolName,
      link: `/tools/${r.toolId}`,
      createdAt: r.date,
    }))

  const welcome = [
    {
      type: NOTIF_TYPE.SYSTEM,
      title: 'Demo laboratory loaded',
      message: `${finalTools.length} tools, ${users.length} users and ${transactions.length} transactions were seeded. Scan any tool QR code to begin.`,
      createdAt: nowISO(),
    },
  ]

  const notifications = buildNotifications([...txnNotifs, ...maintenanceNotifs, ...welcome])

  await db.replaceAll(COLLECTIONS.users, users)
  await db.replaceAll(COLLECTIONS.tools, finalTools)
  await db.replaceAll(COLLECTIONS.transactions, transactions)
  await db.replaceAll(COLLECTIONS.maintenance, maintenanceRecords)
  await db.replaceAll(COLLECTIONS.activityLogs, activityLogs)
  await db.replaceAll(COLLECTIONS.notifications, notifications)
  await db.upsert(COLLECTIONS.settings, { ...DEFAULT_SETTINGS, updatedAt: nowISO() })

  return {
    tools: finalTools.length,
    users: users.length,
    transactions: transactions.length,
    notifications: notifications.length,
    maintenance: maintenanceRecords.length,
    activityLogs: activityLogs.length,
  }
}

/** Seed only when the database is empty — called once on first launch. */
export async function seedIfEmpty() {
  const tools = await db.list(COLLECTIONS.tools)
  const users = await db.list(COLLECTIONS.users)
  if (tools.length || users.length) return null
  return seedDatabase()
}

export const SEED_TOOL_COUNT = TOOL_CATALOG.length
export const SEED_USER_COUNT = USER_CATALOG.length
export const SEED_TXN_COUNT = TRANSACTION_PLAN.length
