// Metro config: monorepo resolution + startup-time optimisations.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

// `@suwappu/design-tokens` lives outside mobile/. Metro needs to be told to
// watch it and where to resolve its deps from, or edits won't hot-reload.
config.watchFolders = [path.resolve(workspaceRoot, 'packages/design-tokens')]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true

// inlineRequires defers module evaluation until first use. This is the single
// biggest TTI win on a large bundle — modules for screens the user hasn't
// opened yet never execute at startup.
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: true,
    inlineRequires: true,
  },
})

module.exports = config
