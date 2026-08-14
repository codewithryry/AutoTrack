/* Throwaway harness — mounts Walkthrough and MascotGreeter inside a mock shell
   so scripts/probe-tour.mjs can measure them. Delete with probe.html. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Package, Wrench, ClipboardList } from 'lucide-react'
import Walkthrough from './components/Walkthrough'
import Mascot, { MascotGreeter, MASCOT_STATE_KEYS, PageMascot } from './components/Mascot'
import { PageHeader } from './components/ui'
import './index.css'

const STEPS = [
  {
    target: 'dash-stats',
    title: 'Your tool record',
    text: 'Your own four totals: tools in your hands, due back soon, already overdue, and still free on the shelf.',
    mascot: 'notification',
  },
  {
    target: 'dash-loans',
    title: 'Tools in your hands',
    text: 'Every tool issued to you, soonest due first, with its tool ID and due date on the row.',
    mascot: 'borrowing',
  },
  {
    target: 'dash-history',
    title: 'Borrowed and returned',
    text: 'The borrow and return records already logged against your account.',
    mascot: 'success',
  },
]

function App() {
  const [online, setOnline] = useState(true)
  const [tourOpen, setTourOpen] = useState(true)
  return (
    <div className="flex min-h-[100dvh] w-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b" style={{ background: 'rgb(var(--surface))' }}>
          <div className="flex h-14 items-center gap-2 px-3">
            <PageMascot pathname="/tools" online={online} className="h-10 shrink-0 sm:h-11" size={44} />
            <h1 className="text-[15px] font-bold">Dashboard</h1>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-3 pb-28 pt-4">
          <section className="mb-5 flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[21px] font-extrabold">Good morning, Rey</h1>
              <p className="muted mt-2 text-[13px]">You are holding 2 tools right now.</p>
              <button
                type="button"
                id="toggle-online"
                onClick={() => setOnline((v) => !v)}
                className="btn btn-outline btn-sm mt-3"
              >
                toggle
              </button>
            </div>
            <MascotGreeter signals={{ online, activeLoans: 2 }} className="h-[92px]" />
          </section>

          <div data-tour="dash-stats" className="mb-4 grid grid-cols-2 gap-3">
            {['Active loans', 'Due soon', 'Overdue', 'Available tools'].map((label) => (
              <div key={label} className="tile p-3.5">
                <p className="subtle text-xs">{label}</p>
                <p className="mono text-2xl font-extrabold">3</p>
              </div>
            ))}
          </div>

          <div data-tour="dash-loans" className="card mb-4 p-0">
            <div className="p-4">
              <p className="text-sm font-bold">Tools you have out</p>
            </div>
            <ul className="divide-y">
              {Array.from({ length: 14 }, (_, i) => (
                <li key={i} className="px-4 py-3 text-sm">
                  Torque Wrench {i + 1} · due tomorrow
                </li>
              ))}
            </ul>
          </div>

          <div data-tour="dash-history" className="card p-4">
            <p className="text-sm font-bold">Your recent transactions</p>
            {Array.from({ length: 6 }, (_, i) => (
              <p key={i} className="muted py-2 text-sm">
                Returned Multimeter {i + 1}
              </p>
            ))}
          </div>
        </main>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        <nav
          className="mx-auto flex max-w-md items-stretch rounded-[22px] border px-1.5 py-1.5"
          style={{ background: 'rgb(var(--surface))' }}
          aria-label="Primary"
        >
          {[Package, Wrench, ClipboardList].map((Icon, i) => (
            <span key={i} className="flex flex-1 flex-col items-center gap-1 py-2">
              <Icon className="h-[22px] w-[22px]" />
              <span className="text-[10px] font-bold">Item</span>
            </span>
          ))}
        </nav>
      </div>

      <Walkthrough steps={STEPS} open={tourOpen} onClose={() => setTourOpen(false)} compact />
    </div>
  )
}

function Headers() {
  return (
    <MemoryRouter initialEntries={['/tools']}>
      <div className="px-3 py-4 sm:px-5">
        <PageHeader hideTitle>
          <button type="button" className="btn btn-outline">
            Export CSV
          </button>
          <button type="button" className="btn btn-primary">
            Add tool
          </button>
        </PageHeader>
        <div className="card p-4">
          <p className="text-sm font-bold">hideTitle + actions (Tools, Notifications)</p>
        </div>
        <div className="mt-6">
          <PageHeader hideTitle />
          <div className="card p-4">
            <p className="text-sm font-bold">hideTitle, no actions (student PWA)</p>
          </div>
        </div>
        <div className="mt-6">
          <PageHeader title="Borrow / Return" description="Issue a tool or take one back" />
          <div className="card p-4">
            <p className="text-sm font-bold">title + description</p>
          </div>
        </div>
      </div>
    </MemoryRouter>
  )
}

function States() {
  return (
    <div className="grid grid-cols-4 gap-4 p-6">
      {MASCOT_STATE_KEYS.map((key) => (
        <div key={key} className="card flex flex-col items-center gap-2 p-3">
          <Mascot state={key} size={120} />
          <p className="text-xs font-bold">{key}</p>
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  new URLSearchParams(location.search).has('states') ? (
    <States />
  ) : new URLSearchParams(location.search).has('header') ? (
    <Headers />
  ) : (
    <App />
  ),
)
