import goenv from 'go-platform'
import gunzip from 'gunzip-maybe'
import path from 'path'
import tarFS from 'tar-fs'
import { Extract } from 'unzip-stream'
import fetch from 'node-fetch'
import Octokit from '@octokit/rest'
import jp from 'jsonpath'
// eslint-disable-next-line @typescript-eslint/no-var-requires

export interface Result {
  fileName: string
  installPath: string
}

function unpack(url: string, installPath: string, stream: NodeJS.ReadableStream) {
  return new Promise((resolve, reject) => {
    if (url.endsWith('.zip')) {
      return stream.pipe(
        Extract({ path: installPath })
          .on('close', resolve)
          .on('error', reject),
      )
    }

    return stream.pipe(gunzip()).pipe(
      tarFS
        .extract(installPath)
        .on('finish', resolve)
        .on('error', reject),
    )
  })
}

async function download(installPath: string, url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Unexpected status: ${res.status}`)
  return unpack(url, installPath, res.body)
}

function cleanArguments(...[version, platform, arch, installPath]: string[]) {
  return {
    version: process.env.TARGET_VERSION || version || 'next',
    platform: process.env.TARGET_OS || platform || goenv.GOOS,
    arch: arch || process.env.TARGET_ARCH || goenv.GOARCH,
    installPath: path.join(installPath ? path.resolve(installPath) : process.cwd(), 'binary'),
  }
}

/**
 * Download (and unpack) textile binary package for desired version, platform and architecture
 *
 * @param version Value in package.json/textile/version
 * @param platform The platform this program is run from
 * @param architecture The architecture of the hardware this program is run from
 * @param installPath The path to extract the binary to. Defaults to './binary'
 * @example
 * ```javascript
 * const download = require('@textile/textile')
 * download("v0.2.1", "linux", "amd64", "/tmp/textile")
 *   .then((res) => console.log('filename:', res.file, "output:", res.dir))
 *   .catch((e) => console.error(e))
 * ```
 */
export default async function(...args: string[]): Promise<Result> {
  const cleaned = await cleanArguments(...args)
  const octokit = new Octokit.Octokit()
  try {
    const settings = { owner: 'textileio', repo: 'textile' }
    let result
    if (cleaned.version === 'next') {
      // @ts-ignore
      result = await octokit.repos.getLatestRelease(settings)
      cleaned.version = result.data.name
    } else {
      result = await octokit.repos.getReleaseByTag({
        ...settings,
        tag: cleaned.version,
      })
    }

    const { data } = result
    const query = jp.query(
      data,
      `$.assets[?(@.name.startsWith("textile_${cleaned.version}_${cleaned.platform}-${cleaned.arch}"))]`,
    )
    if (query.length < 1) {
      throw new Error(`Missing release ${cleaned.version} for ${cleaned.platform}-${cleaned.arch}`)
    }
    const first = query[0]
    const url = first.browser_download_url

    process.stdout.write(`Downloading ${url}\n`)

    await download(cleaned.installPath, url)

    return {
      fileName: first.name,
      installPath: cleaned.installPath + path.sep,
    }
  } catch (err) {
    throw new Error(`Unable to access requested release: ${err.toString()}`)
  }
}
