// Cálculo puro de horário de atendimento — sem I/O, fácil de testar. A orquestração
// (buscar settings no banco, decidir se manda a resposta automática) vive em
// auto-reply.ts.

export interface DaySchedule {
  closed: boolean
  open: string // "HH:mm"
  close: string // "HH:mm"
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type WeekSchedule = Record<Weekday, DaySchedule>

const WEEKDAY_SHORT_TO_KEY: Record<string, Weekday> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
}

/** Dia da semana + hora atual ("HH:mm") no fuso horário informado, via Intl (sem libs). */
export function getLocalWeekdayAndTime(timezone: string, now: Date): { weekday: Weekday; hhmm: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value || 'Mon'
  // hour12:false pode devolver "24" em vez de "00" pra meia-noite em alguns runtimes —
  // normaliza pra manter a comparação lexicográfica "HH:mm" válida.
  const rawHour = parts.find((p) => p.type === 'hour')?.value || '00'
  const hour = rawHour === '24' ? '00' : rawHour.padStart(2, '0')
  const minute = (parts.find((p) => p.type === 'minute')?.value || '00').padStart(2, '0')

  return { weekday: WEEKDAY_SHORT_TO_KEY[weekdayShort] || 'mon', hhmm: `${hour}:${minute}` }
}

/**
 * True quando `now` cai fora do expediente configurado. Não lida com horário que cruza
 * a meia-noite (ex: 22:00–02:00) — assume open < close dentro do mesmo dia, suficiente
 * pro caso de uso (loja com horário comercial normal).
 */
export function isOutsideBusinessHours(schedule: WeekSchedule, timezone: string, now: Date = new Date()): boolean {
  const { weekday, hhmm } = getLocalWeekdayAndTime(timezone, now)
  const day = schedule[weekday]
  if (!day || day.closed) return true
  return !(hhmm >= day.open && hhmm < day.close)
}

export const DEFAULT_SCHEDULE: WeekSchedule = {
  mon: { closed: false, open: '09:00', close: '18:00' },
  tue: { closed: false, open: '09:00', close: '18:00' },
  wed: { closed: false, open: '09:00', close: '18:00' },
  thu: { closed: false, open: '09:00', close: '18:00' },
  fri: { closed: false, open: '09:00', close: '18:00' },
  sat: { closed: false, open: '09:00', close: '13:00' },
  sun: { closed: true, open: '09:00', close: '13:00' },
}

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
}

export const WEEKDAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
