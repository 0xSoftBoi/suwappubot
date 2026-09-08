# Theming - Relay

Source: https://docs.relay.link/references/relay-kit/ui/theming

On this page
Creating a Theme
Fonts
Light/Dark Mode
Usage
UI
Theming
Copy page

Customize the ui theme to fit your app

​
Creating a Theme
RelayKit UI can be fully themed using an intuitive set of theme tokens. You can choose to override all tokens or just a few to make the components match your application theme. You can view the full list of theme overrides here.
import { RelayKitTheme } from '@relayprotocol/relay-kit-ui'

const theme: RelayKitTheme = {
  font: "Inter",
  primaryColor: "#09F9E9"
  focusColor: "#08DECF"
  text: {
    default: "#000"
    subtle: "#fff"
  }
  buttons: {
    primary: {
      color: "#000"
      background: "#09F9E9",
      hover: {
        color: "#000"
        background: "#0ad1c4",
      }
    }
  }
}

​
Fonts
If you are overriding any fonts with custom fonts you need to configure the custom font in your application. For example if you’re using nextjs you can refer to this doc or if you’re pulling the fonts in via css you can refer to this doc.
​
Light/Dark Mode
RelayKit UI has built-in support for light and dark mode themes. The components will automatically adapt their appearance based on the theme mode you specify. To control the theme mode, simply add the light or dark class to your HTML container element:
<!-- Light mode -->
<html class="light">
  ...
</html>

<!-- Dark mode -->
<html class="dark">
  ...
</html>

​
Usage
Now that your theme is configured you’ll just need to pass it into the RelayKitProvider.
import { RelayKitProvider, RelayKitTheme } from '@relayprotocol/relay-kit-ui'

const theme: RelayKitTheme = { ... } //Previously created theme

...

<RelayKitProvider theme={theme}>
  {YOUR_APP}
</RelayKitProvider>


Was this page helpful?

Yes
No
SwapWidget
Troubleshooting
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform