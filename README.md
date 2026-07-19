> ## This is a fork with added features for importing Plateau data
>
> This repository is a fork of [facebook/Rapid](https://github.com/facebook/Rapid) with
> added features for importing building data from [Plateau](https://www.mlit.go.jp/plateau/),
> Japan's open 3D city model published by the Ministry of Land, Infrastructure, Transport
> and Tourism, into OpenStreetMap. A running instance is at **<https://rapid.nyampire.info/>**.
>
> For what this fork adds, how it is built, and how to work on it, see
> **[PLATEAU.md](PLATEAU.md)** (日本語版: **[PLATEAU.ja.md](PLATEAU.ja.md)**).
> The procedure for pulling in upstream releases is in [UPSTREAM_MERGE.md](UPSTREAM_MERGE.md).
>
> Everything below is upstream Rapid's own README, left as-is. Where it differs for this
> fork — such as where to file issues or feature requests — PLATEAU.md takes precedence.

---

[![build](https://github.com/facebook/Rapid/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/facebook/Rapid/actions/workflows/build.yml)
[![npm version](https://badge.fury.io/js/%40rapideditor%2Frapid.svg)](https://badge.fury.io/js/%40rapideditor%2Frapid)


<h1 align="center">Rapid</h1>

Rapid is a modern web-based editor for [OpenStreetMap](https://www.openstreetmap.org/). Rapid integrates advanced mapping tools, authoritative geospatial open data, and cutting-edge technology to empower mappers at all levels to get started quickly, making accurate and fresh edits to maps.

Rapid also includes data integrity checks to ensure that new map edits are consistent and accurate. To learn about all the enhanced features Rapid provides, please check out our [Changelog](CHANGELOG.md) and [training document](https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki#editing-in-rapid).


## Start mapping

* Use [rapideditor.org/edit](https://rapideditor.org/edit) for the latest release.
* Learn more at [rapideditor.org](https://rapideditor.org).


## Participate!

* Read the project [Code of Conduct](CODE_OF_CONDUCT.md) and [Contributing Guide](CONTRIBUTING.md) to learn about how to contribute.
* See [open issues in the issue tracker](https://github.com/facebook/Rapid/issues?state=open) if you're looking to help on issues.
* To help with translating, see the [Translations](CONTRIBUTING.md#translations) section of the Contributing Guide.
* Test a prerelease version of Rapid:
  * The current build of the `main` branch is available here: https://rapideditor.org/canary
  * Note that this [canary build](https://www.pcmag.com/encyclopedia/term/canary-build) of Rapid may be unstable and buggy!

We're available to chat!  Ping us on the `#rapid_feedback` channel on either:
* [OpenStreetMap US Slack](https://slack.openstreetmap.us/)
* [HOTOSM Slack](https://slack.hotosm.org/)


## For developers

Folders under `dist/examples/` contain example code to help you learn how to integrate Rapid editor into your project.
* https://github.com/facebook/Rapid/tree/main/dist/examples


## Requests

| **Request Type**  | **Instructions** |
| ------------- | ------------- |
| :earth_americas: Country Data  | To request Rapid data for other countries, please submit [a new issue](https://github.com/facebook/Rapid/issues/new). |
| :star2: Features  | To request new features in Rapid to enhance your map editing workflow, please submit [a new issue](https://github.com/facebook/Rapid/issues/new). |
| :motorway: Roads  | Please refer to this [list of Available Countries](https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Available-Countries). If you would like to request roads for a new country, please [create an issue here](https://github.com/facebook/Rapid/issues) in this Rapid repo (not in other repos). We track all the requests and our progress on [this page](COUNTRY_REQUESTS.md). |


## License

Rapid is available under the [ISC License](https://opensource.org/licenses/ISC).
See the [LICENSE.md](LICENSE.md) file for more details.
