import { describe, it, expect } from 'vitest'
import { buildPeriod, buildPreviousPeriod, METRICS } from '../metrics'

describe('Analytics Metrics', () => {
  describe('buildPeriod', () => {
    it('deve criar período de 7 dias terminando hoje', () => {
      const asOf = new Date('2026-10-07T12:00:00Z')
      const period = buildPeriod(7, asOf)
      
      expect(period.end).toBe('2026-10-07T23:59:59.999Z')
      expect(period.start).toBe('2026-10-01T00:00:00.000Z')
    })

    it('deve criar período de 30 dias corretamente', () => {
      const asOf = new Date('2026-10-07T12:00:00Z')
      const period = buildPeriod(30, asOf)
      
      expect(period.end).toBe('2026-10-07T23:59:59.999Z')
      expect(period.start).toBe('2026-09-08T00:00:00.000Z')
    })

    it('deve lidar com virada de mês', () => {
      const asOf = new Date('2026-10-05T12:00:00Z')
      const period = buildPeriod(7, asOf)
      
      expect(period.start).toBe('2026-09-29T00:00:00.000Z')
      expect(period.end).toBe('2026-10-05T23:59:59.999Z')
    })
  })

  describe('buildPreviousPeriod', () => {
    it('deve criar período anterior de mesma duração', () => {
      const current = {
        start: '2026-10-01T00:00:00.000Z',
        end: '2026-10-07T23:59:59.999Z',
      }
      const previous = buildPreviousPeriod(current)
      
      // 7 dias = 604800000ms + 1 dia buffer = 691200000ms
      expect(previous.end).toBe('2026-09-30T23:59:59.999Z')
      expect(previous.start).toBe('2026-09-24T00:00:00.000Z')
    })

    it('deve manter mesma duração do período atual', () => {
      const current = {
        start: '2026-09-08T00:00:00.000Z',
        end: '2026-10-07T23:59:59.999Z',
      }
      const previous = buildPreviousPeriod(current)
      
      const currentDuration = new Date(current.end).getTime() - new Date(current.start).getTime()
      const previousDuration = new Date(previous.end).getTime() - new Date(previous.start).getTime()
      
      expect(previousDuration).toBe(currentDuration)
    })
  })

  describe('METRICS definitions', () => {
    it('deve ter todas as métricas obrigatórias definidas', () => {
      const requiredMetrics = [
        'conversations_total',
        'leads_total',
        'leads_hot',
        'deals_won',
        'deals_lost',
        'conversion_rate',
        'revenue',
        'avg_ticket',
        'follow_ups_overdue',
        'recovery_opportunities',
        'pix_requested',
        'payment_confirmed',
        'abandonment_rate',
      ]

      for (const metricId of requiredMetrics) {
        expect(METRICS[metricId]).toBeDefined()
        expect(METRICS[metricId].id).toBe(metricId)
        expect(METRICS[metricId].name).toBeTruthy()
        expect(METRICS[metricId].description).toBeTruthy()
        expect(METRICS[metricId].dateField).toBeTruthy()
        expect(METRICS[metricId].tables.length).toBeGreaterThan(0)
      }
    })

    it('deve ter descrições claras para tooltips', () => {
      for (const metric of Object.values(METRICS)) {
        expect(metric.description.length).toBeGreaterThan(10)
        expect(metric.description.length).toBeLessThan(200)
      }
    })
  })
})