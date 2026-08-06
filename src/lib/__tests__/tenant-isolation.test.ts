import { describe, it, expect } from 'vitest'

interface MockRecord {
  id: string
  organizationId: string
  title: string
}

function filterByTenant<T extends MockRecord>(records: T[], userOrgId: string): T[] {
  return records.filter((r) => r.organizationId === userOrgId)
}

describe('Isolamento Multi-tenant por organization_id', () => {
  const mockDataset: MockRecord[] = [
    { id: '1', organizationId: 'org-quero-ser-fit', title: 'Contato Quero Ser Fit 1' },
    { id: '2', organizationId: 'org-quero-ser-fit', title: 'Contato Quero Ser Fit 2' },
    { id: '3', organizationId: 'org-outra-empresa', title: 'Contato Outra Empresa' },
  ]

  it('deve retornar apenas registros da empresa pertencente ao usuário', () => {
    const userOrgId = 'org-quero-ser-fit'
    const results = filterByTenant(mockDataset, userOrgId)

    expect(results.length).toBe(2)
    expect(results.every((r) => r.organizationId === userOrgId)).toBe(true)
  })

  it('não deve permitir vazamento de dados de outra empresa', () => {
    const userOrgId = 'org-quero-ser-fit'
    const results = filterByTenant(mockDataset, userOrgId)

    const leaked = results.find((r) => r.organizationId === 'org-outra-empresa')
    expect(leaked).toBeUndefined()
  })
})
