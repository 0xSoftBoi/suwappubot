# RelayKitProvider - Relay

Source: https://docs.relay.link/references/relay-kit/ui/relay-kit-provider

On this page
Parameters
Options
UI
RelayKitProvider
Copy page

The provider to setup RelayKit UI

​
Parameters
Parameter	Description	Required
options	An object representing options that customize the underlying RelayKit SDK and RelayKit UI. A full list of options can be found below.	✅
theme	A theme object representing overrides for the default styles	❌
​
Options
Option	Description	Required
codexConfig.apiKey	This key is used to fetch token balances to improve the general user experience and suggest relevant tokens to the user. If omitted the flow will continue to work but balances may be missing from the token selection flow. Refer to the Codex docs on how to get an API key.	❌
codexConfig.apiBaseUrl	The base url for the Codex GraphQL API. If omitted, the default https://graph.codex.io is used. If you prefer to obfuscate and protect your API key, you can pass in a custom endpoint which will be used to fetch the data. In your proxy you can then add the API key and do any additional checks before sending to the Codex API.	❌
disablePoweredByReservoir	A boolean which disables the powered by Reservoir footer	❌
appName	The name of your application, used in the ui to contextualize actions	❌
appFees	An array of objects representing fees. Each object should contains a recipient wallet address and a fee in bps (e.g. 100 = 1%).	❌
themeScheme	The overall theme color of the app, can be light or dark. Defaults to light. This changes the color scheme of icons and other ui elements, in addition to the theme passed in.	❌
acknowledgeApiKeyExposure	Silences the client-side warnings shown when baseApiUrl points directly at the Relay API. GET /requests/v3 requires an API key, so production integrations should proxy requests through their own backend and never ship the key to the browser. Set to true only if you understand the exposure (e.g. a public, rate-limited key).	❌
The options are also a combination of all the parameters passed to the RelayKit SDK. An sdk instance with these options is created when using this provider.

Was this page helpful?

Yes
No
Installation
SwapWidget
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform