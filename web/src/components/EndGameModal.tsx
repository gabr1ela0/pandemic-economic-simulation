import { motion } from 'framer-motion'
import { RotateCcw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatMoney, formatNumber } from '@/lib/utils'
import type { TickRecord } from '@/sim/simulation'

interface EndGameModalProps {
  open: boolean
  onClose: () => void
  onReplay: () => void
  reason: 'resolved' | 'maxDays' | 'manual'
  finalRecord: TickRecord | null
  daysSurvived: number
  peakUnempPct: number
  crisisScore: number
}

const reasonText = {
  resolved: 'Outbreak resolved.',
  maxDays: 'A full year has passed.',
  manual: 'Simulation halted.',
}

export function EndGameModal(props: EndGameModalProps) {
  const r = props.finalRecord
  const stats = r
    ? [
        { label: 'Total deaths', value: formatNumber(r.dead), tone: r.dead > 200 ? 'bad' : 'idle' },
        { label: 'Recovered', value: formatNumber(r.recovered), tone: 'good' },
        { label: 'Peak unemployment', value: `${(props.peakUnempPct * 100).toFixed(1)}%`, tone: props.peakUnempPct > 0.25 ? 'bad' : 'idle' },
        { label: 'Companies bankrupt', value: `${r.companiesBankrupt}`, tone: r.companiesBankrupt > 30 ? 'bad' : 'idle' },
        { label: 'National debt', value: formatMoney(r.nationalDebt), tone: r.nationalDebt > 5_000_000 ? 'warn' : 'idle' },
        { label: 'Bank reserves', value: formatMoney(r.bankReserves), tone: r.bankInCrisis ? 'bad' : 'good' },
        { label: 'Days survived', value: `${props.daysSurvived}`, tone: 'idle' },
      ]
    : []

  const toneColor = (tone: string) =>
    tone === 'bad'
      ? 'text-red-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'good'
          ? 'text-emerald-300'
          : 'text-foreground'

  return (
    <Dialog open={props.open} onOpenChange={(v) => !v && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" /> Outbreak Complete
          </DialogTitle>
          <DialogDescription>{reasonText[props.reason]}</DialogDescription>
        </DialogHeader>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="my-3 rounded-lg border border-border/80 bg-secondary/50 p-4 text-center"
        >
          <div className="text-[10px] font-bold uppercase tracking-widest text-accent">
            Final Crisis Score
          </div>
          <div className="mt-1 font-mono text-4xl font-bold tabular-nums">
            {String(props.crisisScore).padStart(5, '0')}
          </div>
        </motion.div>

        <div className="grid gap-1 text-sm">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.18 }}
              className="flex items-center justify-between border-b border-border/50 py-1.5 last:border-b-0"
            >
              <span className="text-muted-foreground">{s.label}</span>
              <span className={`font-bold tabular-nums ${toneColor(s.tone)}`}>
                {s.value}
              </span>
            </motion.div>
          ))}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={props.onClose}>
            View map
          </Button>
          <Button
            onClick={props.onReplay}
            className="bg-emerald-500 text-black hover:bg-emerald-400"
          >
            <RotateCcw className="h-4 w-4" /> Replay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
