# Android CI builds

Android builds are done via CI to avoid EAS (expo) and are published via releases to avoid artifact expiry and allow [obtainium](https://obtainium.imranr.dev/) to download and auto-update the app.

- "shatteredsky build" is for testing/etc NOT for release as these artifacts will expiry and won't be pushed out to obtainium users
- "shatteredsky release" is for production and will be pushed out to obtainium users and artifacts won't expire
