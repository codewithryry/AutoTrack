import {
  MOBILE_NAV, INSTRUCTOR_MOBILE_NAV, MORE_ACTION, MORE_NAV_ITEM,
  INSTRUCTOR_QUICK_ACTIONS, INSTRUCTOR_MORE_ITEMS, instructorRailItems,
  mobileNavForRole, visibleNavItems,
} from './src/components/navigation.js'
import { ROLE } from './src/utils/constants.js'
import { can, permissionsFor } from './src/utils/permissions.js'

const asUser = (role) => ({ role })
const canFor = (role) => (p) => can(asUser(role), p)

for (const role of [ROLE.ADMIN, ROLE.INSTRUCTOR, ROLE.STUDENT]) {
  const nav = visibleNavItems(role, canFor(role))
  console.log(`\n${role}`)
  console.log('  rail :', (role === ROLE.INSTRUCTOR ? instructorRailItems(nav) : nav).map(i => i.label).join(' | '))
  console.log('  bar  :', mobileNavForRole(role).join(' , '))
}
console.log('\nMORE_ACTION =', MORE_ACTION, '| item label =', MORE_NAV_ITEM.label)
console.log('instructor bar has MORE:', INSTRUCTOR_MOBILE_NAV.includes(MORE_ACTION))
console.log('scan is centre slot:', INSTRUCTOR_MOBILE_NAV[2] === '/scan')
console.log('admin/student bar unchanged:', JSON.stringify(mobileNavForRole(ROLE.ADMIN)) === JSON.stringify(MOBILE_NAV) && JSON.stringify(mobileNavForRole(ROLE.STUDENT)) === JSON.stringify(MOBILE_NAV))
const insCan = canFor(ROLE.INSTRUCTOR)
console.log('quick actions:', INSTRUCTOR_QUICK_ACTIONS.filter(a => !a.permission || insCan(a.permission)).map(a => a.label).join(' | '))
console.log('more sheet   :', INSTRUCTOR_MORE_ITEMS.filter(i => !i.permission || insCan(i.permission)).map(i => i.label).join(' | '))
console.log('instructor perm count (must stay 12):', permissionsFor(ROLE.INSTRUCTOR).length)
