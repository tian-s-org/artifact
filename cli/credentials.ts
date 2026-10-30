/** `artifact login` 拿到的 token 存在这里：0600 的本机文件 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface Credentials {
  url: string
  token: string
  savedAt: string
}

function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(base, 'artifact')
}

export function credentialsPath(): string {
  return path.join(configDir(), 'credentials.json')
}

export async function readCredentials(): Promise<Credentials | null> {
  try {
    const raw = await fs.readFile(credentialsPath(), 'utf8')
    const data = JSON.parse(raw) as Partial<Credentials>
    if (typeof data.token !== 'string' || data.token === '') return null
    return { url: typeof data.url === 'string' ? data.url : '', token: data.token, savedAt: data.savedAt ?? '' }
  } catch {
    return null
  }
}

export async function saveCredentials(creds: Credentials): Promise<string> {
  const dir = configDir()
  await fs.mkdir(dir, { recursive: true })
  const file = credentialsPath()
  await fs.writeFile(file, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(file, 0o600)
  return file
}

export async function clearCredentials(): Promise<void> {
  await fs.rm(credentialsPath(), { force: true })
}
