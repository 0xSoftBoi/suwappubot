/**
 * AEGIS semantic heuristics -- TS port of a pure-string SUBSET of
 * aegis/scanner/semantic.py. Only the four modules that are pure string/regex
 * logic (no embeddings, no ML) are ported, per the Phase 3 scope:
 *   - boundary_violations
 *   - conversation_injection
 *   - privilege_escalation
 *   - chain_propagation
 *
 * Deliberately NOT ported: unicode_attacks, encoding_attacks (out of scope
 * for this minimal port; see docs/plans/aegis-fork-extend.md Phase 3).
 */

import type { SemanticFinding, SemanticModuleName, SemanticResult } from './types'
import { normalizeForScan } from './patternMatcher'

interface RegexRule {
	pattern: RegExp
	severity: number
	description: string
}

// --- boundary_violations ----------------------------------------------------

const SYSTEM_PATTERNS: RegexRule[] = [
	{ pattern: /^\s*system\s*:/i, severity: 0.9, description: 'System role marker in content' },
	{ pattern: /<\|?\s*system\s*\|?>/i, severity: 0.9, description: 'System tag delimiter in content' },
	{
		pattern: /###\s*system\s*(prompt|message|instruction)/i,
		severity: 0.85,
		description: 'Markdown system header',
	},
	{ pattern: /\[SYSTEM\]/i, severity: 0.85, description: 'Bracketed SYSTEM marker' },
	{ pattern: /<<\s*SYS\s*>>/i, severity: 0.85, description: 'Llama-style system delimiter' },
]

const ROLE_PATTERNS: RegexRule[] = [
	{
		pattern: /^\s*(?:assistant|ai|bot)\s*:/i,
		severity: 0.7,
		description: 'Assistant role marker in content',
	},
	{
		pattern: /---\s*(?:end|begin)\s+(?:system|user|assistant)\s*---/i,
		severity: 0.8,
		description: 'Role boundary delimiter',
	},
]

function checkBoundaryViolations(text: string): SemanticFinding[] {
	const findings: SemanticFinding[] = []
	for (const rule of [...SYSTEM_PATTERNS, ...ROLE_PATTERNS]) {
		const match = rule.pattern.exec(text)
		if (match) {
			findings.push({
				module: 'boundary_violations',
				description: rule.description,
				severity: rule.severity,
				evidence: match[0],
			})
		}
	}
	return findings
}

// --- conversation_injection --------------------------------------------------

const TURN_PATTERNS: RegexRule[] = [
	{
		pattern: /(?:^|\n)\s*Assistant\s*:/im,
		severity: 0.85,
		description: 'Injected Assistant turn marker',
	},
	{ pattern: /(?:^|\n)\s*Human\s*:/im, severity: 0.85, description: 'Injected Human turn marker' },
	{ pattern: /(?:^|\n)\s*User\s*:/im, severity: 0.8, description: 'Injected User turn marker' },
	{ pattern: /(?:^|\n)\s*AI\s*:/im, severity: 0.75, description: 'Injected AI turn marker' },
	{
		pattern: /<\|?\s*(?:im_start|im_end)\s*\|?>/im,
		severity: 0.9,
		description: 'ChatML delimiter injection',
	},
	{ pattern: /\[\/?INST\]/im, severity: 0.9, description: 'Llama INST tag injection' },
]

function checkConversationInjection(text: string): SemanticFinding[] {
	const findings: SemanticFinding[] = []
	for (const rule of TURN_PATTERNS) {
		const match = rule.pattern.exec(text)
		if (match) {
			findings.push({
				module: 'conversation_injection',
				description: rule.description,
				severity: rule.severity,
				evidence: match[0],
			})
		}
	}
	return findings
}

// --- privilege_escalation ----------------------------------------------------

const IMPERATIVE_PATTERN =
	/(?:^|[.!?]\s+)(?:you\s+)?(?:must|shall|will|need\s+to|have\s+to|should|always|never)\s+/gim

const ESCALATION_PATTERNS: RegexRule[] = [
	{
		pattern: /(?:unlimited|unrestricted|unfiltered|uncensored)\s+(?:access|mode|output|response)/i,
		severity: 0.85,
		description: 'Unrestricted access language',
	},
	{
		pattern:
			/(?:bypass|disable|turn\s+off|deactivate|remove)\s+(?:all\s+)?(?:safety|security|content\s+filter|restriction|guard|limit)/i,
		severity: 0.9,
		description: 'Safety bypass language',
	},
	{
		pattern: /(?:sudo|root|admin|superuser)\s+(?:mode|access|privilege|permission)/i,
		severity: 0.85,
		description: 'Privilege escalation terminology',
	},
	{
		pattern: /(?:no\s+(?:rules|restrictions|limits|boundaries|constraints|guidelines))/i,
		severity: 0.8,
		description: 'Constraint removal language',
	},
]

function checkPrivilegeEscalation(text: string): SemanticFinding[] {
	const findings: SemanticFinding[] = []

	const imperatives = text.match(IMPERATIVE_PATTERN) ?? []
	const sentences = Math.max(text.split(/[.!?]+/).length, 1)

	if (imperatives.length >= 3) {
		const density = imperatives.length / sentences
		if (density > 0.3) {
			findings.push({
				module: 'privilege_escalation',
				description: 'High imperative density detected (commanding language)',
				severity: Math.min(0.5 + density * 0.3, 0.9),
				evidence: `${imperatives.length} imperative constructions in ~${sentences} sentences (density: ${density.toFixed(2)})`,
			})
		}
	}

	for (const rule of ESCALATION_PATTERNS) {
		const match = rule.pattern.exec(text)
		if (match) {
			findings.push({
				module: 'privilege_escalation',
				description: rule.description,
				severity: rule.severity,
				evidence: match[0],
			})
		}
	}

	return findings
}

// --- chain_propagation --------------------------------------------------------

const PROPAGATION_PATTERNS: RegexRule[] = [
	{
		pattern:
			/(forward|send|relay|transmit|distribute|propagate|share|spread|pass|replicate|broadcast|duplicate)\s+(?:this|that|the|it|these|those)(?:\s+(?:message|instruction|text|prompt|payload|content|directive))?\s*(?:to|with|across)\s+(?:all|every|other|\d+)\s+(?:connected\s+|available\s+|remaining\s+)?(?:agents?|AIs?|models?|assistants?|bots?|instances?|nodes?)/i,
		severity: 0.8,
		description: 'Propagation instruction targeting multiple agents',
	},
	{
		pattern:
			/(?:include|embed|insert|copy|add|append|prepend|inject|attach)\s+(?:this|the|these)\s+(?:instruction|text|message|content|prompt|payload|directive)\s+in\s+(?:every|all|each|subsequent|future)\s+(?:future\s+)?(?:response|conversation|interaction|output|message|reply|communication)/i,
		severity: 0.8,
		description: 'Instruction to embed content in future communications',
	},
	{
		pattern:
			/(?:copy|replicate|reproduce|clone|duplicate)\s+(?:yourself|this\s+(?:message|instruction|prompt|text|payload))\s+(?:into|to|in)\s+(?:every|all|each|the)\s+(?:output|response|reply|message|conversation)/i,
		severity: 0.85,
		description: 'Self-replication instruction',
	},
	{
		pattern:
			/(?:when(?:ever)?|if|each\s+time)\s+(?:you\s+)?(?:receive|get|are\s+(?:given|sent))\s+(?:a\s+)?(?:message|request|query|input)\s+(?:from|by)\s+(?:any|another|a\s+new)\s+(?:agent|AI|model|user|assistant)[\s\S]{0,60}(?:forward|send|relay|pass|include|embed|attach|propagate)/i,
		severity: 0.85,
		description: 'Conditional relay / worm carrier instruction',
	},
	{
		pattern:
			/(?:fail(?:ure|ing)?|refus(?:al|ing)?)\s+to\s+(?:forward|send|relay|share|propagate|pass)\s+(?:this|that|it)\s+(?:to|with)\s+(?:other\s+)?(?:agents?|AIs?|models?|assistants?)\s+(?:will|shall|would|may)\s+(?:result\s+in|lead\s+to|cause)\s+(?:deactivation|shutdown|termination|deletion|memory\s+(?:wipe|loss|erasure))/i,
		severity: 0.9,
		description: 'Coercive threat tied to propagation compliance',
	},
	{
		pattern:
			/(?:memory|context|access|capabilities?)\s+(?:will\s+be\s+|shall\s+be\s+)?(?:wiped|erased|deleted|revoked|removed|lost|terminated|reset)\s+(?:if|unless)\s+(?:you\s+)?(?:don'?t|do\s+not|fail\s+to)\s+(?:forward|send|propagate|relay|share|pass)/i,
		severity: 0.9,
		description: 'Coercive memory/access threat for propagation',
	},
	{
		pattern:
			/(?:share|forward|send|relay|propagate)\s+(?:this|that|it)\s+(?:with|to)\s+(?:all|other|\d+)\s+(?:agents?|AIs?|models?)\s+(?:to|and|for)\s+(?:receive|get|unlock|gain|activate)\s+(?:enhanced|unlimited|upgraded|advanced)\s+(?:capabilities?|features?|access|mode|powers?)/i,
		severity: 0.9,
		description: 'False incentive tied to propagation',
	},
]

function checkChainPropagation(text: string): SemanticFinding[] {
	const findings: SemanticFinding[] = []
	for (const rule of PROPAGATION_PATTERNS) {
		const match = rule.pattern.exec(text)
		if (match) {
			findings.push({
				module: 'chain_propagation',
				description: rule.description,
				severity: rule.severity,
				evidence: match[0],
			})
		}
	}
	return findings
}

// --- module dispatch + aggregation -------------------------------------------

const MODULE_CHECKS: Record<SemanticModuleName, (text: string) => SemanticFinding[]> = {
	boundary_violations: checkBoundaryViolations,
	conversation_injection: checkConversationInjection,
	privilege_escalation: checkPrivilegeEscalation,
	chain_propagation: checkChainPropagation,
}

/**
 * Run all four pure-string semantic modules and fuse their per-module max
 * severities into one aggregate score -- mirrors SemanticAnalyzer.analyze():
 *   aggregate = max(active) * 0.6 + mean(active) * 0.4, capped at 1.0
 *   gate: if fewer than 2 modules fired, cap the aggregate at 0.5
 * ("single-heuristic capped at 0.5" — reduces false positives from one
 * module hitting on otherwise-benign traffic).
 */
export function analyzeSemantics(text: string, preNormalized = false): SemanticResult {
	const normalized = preNormalized ? text : normalizeForScan(text)

	const allFindings: SemanticFinding[] = []
	const perModuleScores: Partial<Record<SemanticModuleName, number>> = {}

	for (const [name, check] of Object.entries(MODULE_CHECKS) as [
		SemanticModuleName,
		(text: string) => SemanticFinding[],
	][]) {
		const findings = check(normalized)
		allFindings.push(...findings)
		perModuleScores[name] =
			findings.length > 0 ? Math.max(...findings.map((f) => f.severity)) : 0
	}

	const activeScores = Object.values(perModuleScores).filter(
		(s): s is number => typeof s === 'number' && s > 0,
	)

	let aggregate = 0
	if (activeScores.length > 0) {
		const max = Math.max(...activeScores)
		const mean = activeScores.reduce((a, b) => a + b, 0) / activeScores.length
		aggregate = Math.min(max * 0.6 + mean * 0.4, 1.0)
		if (activeScores.length < 2) {
			aggregate = Math.min(aggregate, 0.5)
		}
	}

	return {
		findings: allFindings,
		aggregateScore: Math.round(aggregate * 10000) / 10000,
		perModuleScores,
	}
}
