import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout, AppHeader } from '../components/layout'
import { api } from '../lib/api'
import { a11yToast } from '../lib/a11yToast'
import type { EnterpriseOrg, OrgMember, OrgApiKey, OrgApiKeyCreated, OrgUsage, OrgRole } from '../lib/api'

type Tab = 'team' | 'apikeys' | 'usage'

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

const ROLE_COLORS: Record<OrgRole, string> = {
  owner: 'bg-suwappu-magenta-mid/10 text-suwappu-magenta-mid',
  admin: 'bg-blue-100 text-blue-700',
  member: 'bg-green-100 text-green-700',
  viewer: 'bg-gray-100 text-gray-600',
}

const ALL_SCOPES = ['swap:execute', 'trade:read', 'portfolio:read']

export function Enterprise() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('team')

  // Org resolution
  const [orgId, setOrgId] = useState<string | null>(null)
  const [noOrg, setNoOrg] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Org state
  const [org, setOrg] = useState<EnterpriseOrg | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [apiKeys, setApiKeys] = useState<OrgApiKey[]>([])
  const [usage, setUsage] = useState<OrgUsage | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)

  // Onboarding state
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Modal state
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteUserId, setInviteUserId] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('member')

  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(['trade:read', 'portfolio:read'])
  const [newKeyExpiry, setNewKeyExpiry] = useState('')

  const [createdKey, setCreatedKey] = useState<OrgApiKeyCreated | null>(null)

  const [confirmRemoveMember, setConfirmRemoveMember] = useState<string | null>(null)
  const [confirmRevokeKey, setConfirmRevokeKey] = useState<string | null>(null)

  // Resolve the user's org on mount
  useEffect(() => {
    async function resolveOrg() {
      try {
        const myOrg = await api.getMyOrg()
        if (myOrg === null) {
          setNoOrg(true)
          setIsLoading(false)
        } else {
          setOrgId(myOrg.id)
          setOrg(myOrg)
        }
      } catch (err) {
        console.error(err)
        setError('Failed to load organization data')
        setIsLoading(false)
      }
    }
    resolveOrg()
  }, [])

  const loadAll = useCallback(async (resolvedOrgId: string) => {
    try {
      setIsLoading(true)
      const [orgData, membersData, keysData, usageData] = await Promise.allSettled([
        api.getOrg(resolvedOrgId),
        api.getOrgMembers(resolvedOrgId),
        api.getApiKeys(resolvedOrgId),
        api.getOrgUsage(resolvedOrgId),
      ])

      if (orgData.status === 'fulfilled') setOrg(orgData.value)
      if (membersData.status === 'fulfilled') setMembers(membersData.value)
      if (keysData.status === 'fulfilled') setApiKeys(keysData.value)
      if (usageData.status === 'fulfilled') setUsage(usageData.value)

      if (
        orgData.status === 'rejected' &&
        membersData.status === 'rejected' &&
        keysData.status === 'rejected'
      ) {
        setError('Failed to load organization data')
      }
    } catch (err) {
      console.error(err)
      setError('Failed to load organization data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (orgId) {
      loadAll(orgId)
    }
  }, [orgId, loadAll])

  // ---- Create org onboarding ----

  const handleCreateOrg = async () => {
    if (!createName.trim() || !createSlug.trim()) return
    setIsCreating(true)
    try {
      const newOrg = await api.createOrg(createName.trim(), createSlug.trim())
      setOrg(newOrg)
      setOrgId(newOrg.id)
      setNoOrg(false)
    } catch (err: any) {
      console.error(err)
      a11yToast.error(err?.detail || 'Failed to create organization')
    } finally {
      setIsCreating(false)
    }
  }

  // ---- Actions ----

  const handleInvite = async () => {
    const parsedUserId = parseInt(inviteUserId.trim(), 10)
    if (!inviteUserId.trim() || isNaN(parsedUserId)) {
      a11yToast.error('Please enter a valid numeric Telegram user ID')
      return
    }
    if (!orgId) return
    setIsBusy(true)
    try {
      const member = await api.inviteMember(orgId, parsedUserId, inviteRole)
      setMembers((prev) => [...prev, member])
      setShowInviteModal(false)
      setInviteUserId('')
      setInviteRole('member')
      a11yToast.success('Member invited successfully')
    } catch (err: any) {
      console.error(err)
      a11yToast.error(err?.detail || 'Failed to invite member')
    } finally {
      setIsBusy(false)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!orgId) return
    setIsBusy(true)
    try {
      await api.removeMember(orgId, userId)
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
      setConfirmRemoveMember(null)
      a11yToast.success('Member removed')
    } catch (err: any) {
      console.error(err)
      a11yToast.error(err?.detail || 'Failed to remove member')
    } finally {
      setIsBusy(false)
    }
  }

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || !orgId) return
    setIsBusy(true)
    try {
      const result = await api.createApiKey(orgId, newKeyName.trim(), newKeyScopes, newKeyExpiry || undefined)
      setApiKeys((prev) => [...prev, result])
      setCreatedKey(result)
      setShowCreateKeyModal(false)
      setNewKeyName('')
      setNewKeyScopes(['trade:read', 'portfolio:read'])
      setNewKeyExpiry('')
    } catch (err: any) {
      console.error(err)
      a11yToast.error(err?.detail || 'Failed to create API key')
    } finally {
      setIsBusy(false)
    }
  }

  const handleRevokeKey = async (keyId: string) => {
    if (!orgId) return
    setIsBusy(true)
    try {
      await api.revokeApiKey(orgId, keyId)
      setApiKeys((prev) => prev.filter((k) => k.id !== keyId))
      setConfirmRevokeKey(null)
      a11yToast.success('API key revoked')
    } catch (err: any) {
      console.error(err)
      a11yToast.error(err?.detail || 'Failed to revoke API key')
    } finally {
      setIsBusy(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      a11yToast.success('Copied to clipboard')
    })
  }

  // ---- Render helpers ----

  function renderTeamTab() {
    return (
      <div className="space-y-4">
        {/* Seat usage */}
        {org && (
          <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-heading font-semibold text-suwappu-text">Seats</span>
              <span className="text-sm text-suwappu-text-secondary">
                {org.memberCount} / {org.seatLimit} used
              </span>
            </div>
            <div className="h-2 bg-suwappu-sakura-light rounded-full overflow-hidden">
              <div
                className="h-full bg-suwappu-gradient rounded-full transition-all"
                style={{ width: `${Math.min(100, (org.memberCount / org.seatLimit) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Member list */}
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-4 py-3 border-b border-suwappu-sakura-mid/10 flex items-center justify-between">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Team Members</span>
            <button
              onClick={() => setShowInviteModal(true)}
              className="text-xs font-semibold text-suwappu-magenta-mid"
            >
              + Invite
            </button>
          </div>

          {members.length === 0 ? (
            <div className="p-6 text-center text-sm text-suwappu-text-secondary">
              No members yet. Invite your first team member.
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {members.map((m) => (
                <div key={m.userId} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-suwappu-gradient flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-sm font-bold">
                      {(m.firstName || m.username || m.userId).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-suwappu-text truncate">
                      {m.firstName || (m.username ? `@${m.username}` : `User ${m.userId}`)}
                    </p>
                    <p className="text-xs text-suwappu-text-secondary">
                      Joined {new Date(m.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[m.role]}`}>
                    {ROLE_LABELS[m.role]}
                  </span>
                  {m.role !== 'owner' && (
                    <button
                      onClick={() => setConfirmRemoveMember(m.userId)}
                      className="text-suwappu-error/70 hover:text-suwappu-error text-xs ml-1"
                      aria-label="Remove member"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderApiKeysTab() {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
          <div className="px-4 py-3 border-b border-suwappu-sakura-mid/10 flex items-center justify-between">
            <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">API Keys</span>
            <button
              onClick={() => setShowCreateKeyModal(true)}
              className="text-xs font-semibold text-suwappu-magenta-mid"
            >
              + New Key
            </button>
          </div>

          {apiKeys.length === 0 ? (
            <div className="p-6 text-center text-sm text-suwappu-text-secondary">
              No API keys yet. Create one to start building integrations.
            </div>
          ) : (
            <div className="divide-y divide-suwappu-sakura-mid/10">
              {apiKeys.map((key) => (
                <div key={key.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-suwappu-text">{key.name}</p>
                      <p className="text-xs font-mono text-suwappu-text-secondary mt-0.5">
                        {key.prefix}...
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {key.scopes.map((s) => (
                          <span key={s} className="text-xs bg-suwappu-sakura-light text-suwappu-purple-deep px-1.5 py-0.5 rounded">
                            {s}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-suwappu-text-secondary mt-1">
                        {key.lastUsedAt
                          ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                          : 'Never used'}
                        {key.expiresAt && ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    <button
                      onClick={() => setConfirmRevokeKey(key.id)}
                      className="text-xs text-suwappu-error/70 hover:text-suwappu-error flex-shrink-0 mt-0.5"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderUsageTab() {
    if (!usage) {
      return (
        <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
          <p className="text-sm text-suwappu-text-secondary">
            Usage data will appear once your first API call is made.
          </p>
        </div>
      )
    }

    const stats = [
      { label: 'API calls today', value: usage.callsToday.toLocaleString() },
      { label: 'API calls this month', value: usage.callsThisMonth.toLocaleString() },
      { label: 'Rate limit hits', value: usage.rateLimitHits.toLocaleString() },
    ]

    return (
      <div className="space-y-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-suwappu-xl shadow-suwappu-1 px-4 py-4 flex items-center justify-between">
            <span className="text-sm text-suwappu-text">{s.label}</span>
            <span className="font-heading font-bold text-suwappu-purple-deep text-lg">{s.value}</span>
          </div>
        ))}
      </div>
    )
  }

  // ---- Loading / error / no-org states ----

  if (isLoading) {
    return (
      <AppLayout header={<AppHeader title="Enterprise" showBack onBack={() => navigate(-1)} />} activeNav="settings">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-suwappu-magenta-mid" />
        </div>
      </AppLayout>
    )
  }

  if (error) {
    return (
      <AppLayout header={<AppHeader title="Enterprise" showBack onBack={() => navigate(-1)} />} activeNav="settings">
        <div className="p-6 flex flex-col items-center gap-4">
          <p className="text-sm text-suwappu-error text-center">{error}</p>
          <button
            onClick={() => {
              setError(null)
              setIsLoading(true)
              api.getMyOrg().then((myOrg) => {
                if (myOrg === null) { setNoOrg(true); setIsLoading(false) }
                else { setOrgId(myOrg.id); setOrg(myOrg) }
              }).catch((err) => {
                console.error(err)
                setError('Failed to load organization data')
                setIsLoading(false)
              })
            }}
            className="px-4 py-2 bg-suwappu-gradient text-white rounded-suwappu-lg text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      </AppLayout>
    )
  }

  if (noOrg) {
    return (
      <AppLayout header={<AppHeader title="Enterprise" showBack onBack={() => navigate(-1)} />} activeNav="settings">
        <div className="p-5 space-y-5">
          <div className="bg-suwappu-sakura-light/50 rounded-suwappu-xl p-4">
            <p className="font-heading font-bold text-suwappu-purple-deep mb-1">Create your organization</p>
            <p className="text-xs text-suwappu-text-secondary">
              Set up your enterprise org to manage team members and API keys.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-suwappu-text-secondary mb-1 block">Organization name</label>
              <input
                type="text"
                placeholder="e.g. Acme Corp"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
            </div>
            <div>
              <label className="text-xs text-suwappu-text-secondary mb-1 block">Slug (URL-safe identifier)</label>
              <input
                type="text"
                placeholder="e.g. acme-corp"
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
              />
            </div>
          </div>

          <button
            onClick={handleCreateOrg}
            disabled={isCreating || !createName.trim() || !createSlug.trim()}
            className="w-full py-3 bg-suwappu-gradient text-white rounded-suwappu-lg text-sm font-semibold disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create Organization'}
          </button>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout header={<AppHeader title="Enterprise" showBack onBack={() => navigate(-1)} />} activeNav="settings">
      <div className="p-3 pb-24 space-y-4">
        {/* Org header */}
        {org && (
          <div className="bg-suwappu-sakura-light/50 rounded-suwappu-xl px-4 py-3">
            <p className="font-heading font-bold text-suwappu-purple-deep">{org.name}</p>
            <p className="text-xs text-suwappu-text-secondary">/{org.slug}</p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 bg-suwappu-sakura-light rounded-suwappu-lg p-1">
          {(['team', 'apikeys', 'usage'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-suwappu-md text-xs font-heading font-semibold transition-colors ${
                tab === t
                  ? 'bg-white text-suwappu-purple-deep shadow-suwappu-1'
                  : 'text-suwappu-text-secondary'
              }`}
            >
              {t === 'team' ? 'Team' : t === 'apikeys' ? 'API Keys' : 'Usage'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'team' && renderTeamTab()}
        {tab === 'apikeys' && renderApiKeysTab()}
        {tab === 'usage' && renderUsageTab()}
      </div>

      {/* Invite modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setShowInviteModal(false)}>
          <div className="w-full bg-white rounded-t-suwappu-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-bold text-suwappu-purple-deep">Invite Member</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-suwappu-text-secondary mb-1 block">Telegram User ID</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 123456789"
                  value={inviteUserId}
                  onChange={(e) => setInviteUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
                />
              </div>
              <div>
                <label className="text-xs text-suwappu-text-secondary mb-1 block">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowInviteModal(false)}
                className="flex-1 py-2.5 rounded-suwappu-lg border border-suwappu-sakura-mid text-sm text-suwappu-text-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={isBusy || !inviteUserId.trim() || isNaN(parseInt(inviteUserId.trim(), 10))}
                className="flex-1 py-2.5 bg-suwappu-gradient text-white rounded-suwappu-lg text-sm font-semibold disabled:opacity-50"
              >
                {isBusy ? 'Inviting...' : 'Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create API key modal */}
      {showCreateKeyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setShowCreateKeyModal(false)}>
          <div className="w-full bg-white rounded-t-suwappu-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-bold text-suwappu-purple-deep">New API Key</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-suwappu-text-secondary mb-1 block">Key name</label>
                <input
                  type="text"
                  placeholder="e.g. Production"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
                />
              </div>

              <div>
                <label className="text-xs text-suwappu-text-secondary mb-2 block">Scopes</label>
                <div className="space-y-2">
                  {ALL_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newKeyScopes.includes(scope)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewKeyScopes((prev) => [...prev, scope])
                          } else {
                            setNewKeyScopes((prev) => prev.filter((s) => s !== scope))
                          }
                        }}
                        className="w-4 h-4 accent-suwappu-magenta-mid"
                      />
                      <span className="text-sm text-suwappu-text">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-suwappu-text-secondary mb-1 block">Expiry (optional)</label>
                <input
                  type="date"
                  value={newKeyExpiry}
                  onChange={(e) => setNewKeyExpiry(e.target.value)}
                  className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowCreateKeyModal(false)}
                className="flex-1 py-2.5 rounded-suwappu-lg border border-suwappu-sakura-mid text-sm text-suwappu-text-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateKey}
                disabled={isBusy || !newKeyName.trim() || newKeyScopes.length === 0}
                className="flex-1 py-2.5 bg-suwappu-gradient text-white rounded-suwappu-lg text-sm font-semibold disabled:opacity-50"
              >
                {isBusy ? 'Creating...' : 'Create Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New key reveal modal */}
      {createdKey && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50">
          <div className="w-full bg-white rounded-t-suwappu-2xl p-5 space-y-4">
            <h3 className="font-heading font-bold text-suwappu-purple-deep">API Key Created</h3>

            <div className="bg-orange-50 border border-orange-200 rounded-suwappu-lg p-3">
              <p className="text-xs text-orange-700 font-medium">
                Save this key now. It will not be shown again.
              </p>
            </div>

            <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-3">
              <p className="font-mono text-xs text-suwappu-purple-deep break-all">{createdKey.rawKey}</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => copyToClipboard(createdKey.rawKey)}
                className="flex-1 py-2.5 rounded-suwappu-lg border border-suwappu-magenta-mid text-sm font-semibold text-suwappu-magenta-mid"
              >
                Copy Key
              </button>
              <button
                onClick={() => setCreatedKey(null)}
                className="flex-1 py-2.5 bg-suwappu-gradient text-white rounded-suwappu-lg text-sm font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm remove member */}
      {confirmRemoveMember && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setConfirmRemoveMember(null)}>
          <div className="w-full bg-white rounded-t-suwappu-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-bold text-suwappu-purple-deep">Remove Member?</h3>
            <p className="text-sm text-suwappu-text-secondary">
              This member will lose access to the organization immediately.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRemoveMember(null)}
                className="flex-1 py-2.5 rounded-suwappu-lg border border-suwappu-sakura-mid text-sm text-suwappu-text-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemoveMember(confirmRemoveMember)}
                disabled={isBusy}
                className="flex-1 py-2.5 bg-suwappu-error text-white rounded-suwappu-lg text-sm font-semibold disabled:opacity-50"
              >
                {isBusy ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm revoke key */}
      {confirmRevokeKey && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setConfirmRevokeKey(null)}>
          <div className="w-full bg-white rounded-t-suwappu-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-bold text-suwappu-purple-deep">Revoke API Key?</h3>
            <p className="text-sm text-suwappu-text-secondary">
              Any integrations using this key will stop working immediately.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRevokeKey(null)}
                className="flex-1 py-2.5 rounded-suwappu-lg border border-suwappu-sakura-mid text-sm text-suwappu-text-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRevokeKey(confirmRevokeKey)}
                disabled={isBusy}
                className="flex-1 py-2.5 bg-suwappu-error text-white rounded-suwappu-lg text-sm font-semibold disabled:opacity-50"
              >
                {isBusy ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
