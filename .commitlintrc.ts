const CONFIGURATION = {
	extends: ['@commitlint/config-conventional'],
	// The default conventional parser's headerPattern uses `\w*`, which can never match the hyphenated
	// types declared in the enum below (`BREAKING-CHANGE`, `cherry-pick`) — they fail with misleading
	// `type-empty`/`subject-empty` errors. This override widens the type capture to `[\w-]+`.
	parserPreset: {
		parserOpts: {
			headerCorrespondence: ['type', 'scope', 'subject'],
			// eslint-disable-next-line security/detect-unsafe-regex
			headerPattern: /^([\w-]+)(?:\(([^)]*)\))?!?: (.+)$/,
		},
	},
	rules: {
		'header-trim': [2, 'always'],
		'header-max-length': [2, 'always', 160],
		'body-leading-blank': [2, 'always'],
		'body-max-line-length': [2, 'always', 1000],
		'footer-leading-blank': [2, 'always'],
		'footer-max-line-length': [2, 'always', 160],
		'scope-case': [1, 'always', 'lower-case'],
		// Disabled: a mid-sentence acronym (URL, API, SSR, CSP) satisfies none of commitlint's
		// allowed cases, so every technically accurate subject in this stack would warn.
		// `subject-empty`, `subject-full-stop` and `header-max-length` still guard the subject.
		'subject-case': [0],
		'subject-empty': [2, 'never'],
		'subject-full-stop': [2, 'never', '.'],
		// `upper-case` is allowed solely for the `BREAKING-CHANGE` type; the type-enum below still
		// restricts which types are legal, so this loosens nothing else.
		'type-case': [2, 'always', ['lower-case', 'upper-case']],
		'type-empty': [2, 'never'],
		'type-enum': [
			2,
			'always',
			[
				'BREAKING-CHANGE',
				'build',
				'cherry-pick',
				'chore',
				'ci',
				'comment',
				'config',
				'deps',
				'docs',
				'feat',
				'fix',
				'hotfix',
				'merge',
				'perf',
				'prune',
				'refactor',
				'revert',
				'security',
				'style',
				'temp',
				'test',
				'version',
				'wip',
			],
		],
	},
	prompt: {
		questions: {
			type: {
				description: 'Choose the type of change for your commit',
				enum: {
					'BREAKING-CHANGE': {
						description:
							'A commit whose sole content is the backward-incompatible break; otherwise use "<type>!:" with a "BREAKING CHANGE:" footer',
						title: 'BREAKING-CHANGE',
						emoji: '💥',
					},
					build: {
						description:
							'Modifications to the build pipeline and the produced artifact, including the Vite library build configuration, output formats, declaration generation, and build scripts',
						title: 'Build',
						emoji: '🏗️',
					},
					'cherry-pick': {
						description: 'A hand-authored cherry-pick commit whose original message is not reused',
						title: 'Cherry-pick',
						emoji: '🍒',
					},
					chore: {
						description:
							'Residual maintenance that fits no other type, explicitly excluding dependencies (deps), developer-tooling configuration (config), and the build pipeline (build)',
						title: 'Chore',
						emoji: '🧹',
					},
					ci: {
						description:
							'Updates to continuous integration and deployment configuration, including workflow scripts and automation tools',
						title: 'CI',
						emoji: '👷',
					},
					comment: {
						description:
							'Modifications to non-documentation inline comments, such as explanations and section banners; JSDoc and "@component" are docs',
						title: 'Comment',
						emoji: '💡',
					},
					config: {
						description:
							'Modifications to developer-tooling configuration that does not change the built artifact, including linters, formatters, TypeScript, editor, git hooks, and test runners',
						title: 'Config',
						emoji: '🔧',
					},
					deps: {
						description:
							'Add, update, or remove dependencies or package manager lockfile (e.g., package.json, pnpm-lock.yaml, etc.)',
						title: 'Dependencies',
						emoji: '📦',
					},
					docs: {
						description:
							'Changes to Markdown documentation (README, CHANGELOG, documentation/) or in-code documentation (JSDoc); plain inline comments are comment',
						title: 'Documentation',
						emoji: '📝',
					},
					feat: {
						description: 'A new user-facing functionality or capability',
						title: 'Feature',
						emoji: '✨',
					},
					fix: {
						description: 'A bug fix or issue resolution',
						title: 'Fix',
						emoji: '🐛',
					},
					hotfix: {
						description:
							'An urgent fix for a critical production issue on a release or production branch that requires immediate attention',
						title: 'Hotfix',
						emoji: '🚑️',
					},
					merge: {
						description:
							'A hand-authored merge commit (e.g., "git merge --no-ff --no-commit" then commit); git default merge messages bypass commitlint',
						title: 'Merge',
						emoji: '🔀',
					},
					perf: {
						description: 'Performance optimization with no functional change',
						title: 'Performance',
						emoji: '⚡',
					},
					prune: {
						description: 'Removal of dead code, unused files, or obsolete assets with no replacement',
						title: 'Prune',
						emoji: '🔥',
					},
					refactor: {
						description:
							'Restructuring or improving existing code without changing its behavior or adding new features',
						title: 'Refactor',
						emoji: '♻️',
					},
					revert: {
						description: 'Undoes or rolls back a previous commit to restore the codebase to a prior state',
						title: 'Revert',
						emoji: '⏪',
					},
					security: {
						description: 'Addresses security vulnerabilities or implements security enhancements',
						title: 'Security',
						emoji: '🔒',
					},
					style: {
						description:
							'Changes to code formatting that do not impact logic or functionality, such as modifying whitespace, indentation, semicolons, or applying code style rules.',
						title: 'Style',
						emoji: '🎨',
					},
					temp: {
						description:
							'A throwaway commit, such as debug toggles or scaffolding, to be dropped before merge; wip is incomplete real work to be squashed',
						title: 'Temp',
						emoji: '⏰',
					},
					test: {
						description: 'Adds or improves test coverage by adding new tests or fixing existing test cases',
						title: 'Test',
						emoji: '🧪',
					},
					version: {
						description: 'Updates project version or version-related metadata',
						title: 'Version',
						emoji: '🔖',
					},
					wip: {
						description: 'Incomplete real work saved to keep progress, squashed before merge',
						title: 'WIP',
						emoji: '🚧',
					},
				},
			},
			scope: {
				description:
					'Specify the scope of the change, such as the affected component, module, or file.\nThe scope is lower-case; task or issue identifiers belong in the footer (the issues question).\nNote: The scope will be automatically enclosed in parentheses.',
			},
			subject: {
				description: 'Provide a concise, imperative mood summary of the change in the present tense',
			},
			body: {
				description:
					'Provide a comprehensive explanation of the change, detailing the motivation, implementation approach, and any additional context that helps understand the modification',
			},
			isBreaking: {
				description:
					'Indicate whether this commit introduces any breaking changes to the existing codebase (true or false)',
			},
			breakingBody: {
				description:
					"A 'BREAKING-CHANGE' commit requires a comprehensive explanation detailing the nature of the breaking changes, their impact on the codebase, and any necessary migration steps or considerations",
			},
			isIssueAffected: {
				description: 'Indicate whether this commit resolves or relates to any existing issues or tasks (true or false)',
			},
			issues: {
				description: 'Reference related issues or tasks using their identifier (e.g., "fix #123", "closes #456")',
			},
			issuesBody: {
				description:
					'When issues are resolved, provide a comprehensive explanation detailing the changes, their impact, and the specific resolution',
			},
		},
	},
} as const;

export default CONFIGURATION;
