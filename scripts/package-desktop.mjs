import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const revision = '61881b1f7f0b13d9e46d561fc25afcd6bbaec479'
const host = spawnSync('rustc', ['--print', 'host-tuple'], { cwd: root, encoding: 'utf8' })
if (host.status !== 0 || !host.stdout?.trim()) throw new Error('Install Rust before packaging Lekhan.')
const target = host.stdout.trim()
const backend = process.env.LEKHAN_LLAMA_BACKEND ?? (process.platform === 'darwin' ? 'metal' : 'cpu')
if (!['cpu', 'metal', 'cuda', 'vulkan'].includes(backend) || (backend === 'metal' && process.platform !== 'darwin')) {
  throw new Error('Choose one of the supported llama.cpp build backends for this platform.')
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error(command + ' did not complete.', { cause: result.error })
}

const cache = join(root, 'src-tauri', 'target', 'llama-cpp', revision)
const source = process.env.LEKHAN_LLAMA_SOURCE ? resolve(process.env.LEKHAN_LLAMA_SOURCE) : join(cache, 'source')
if (!process.env.LEKHAN_LLAMA_SOURCE) {
  if (!existsSync(join(source, '.git'))) {
    mkdirSync(source, { recursive: true })
    run('git', ['init', '--quiet'], source)
    run('git', ['remote', 'add', 'origin', 'https://github.com/ggml-org/llama.cpp.git'], source)
  }
  if (!existsSync(join(source, 'CMakeLists.txt'))) {
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', revision], source)
  }
  run('git', ['checkout', '--quiet', '--detach', revision], source)
}
const build = process.env.LEKHAN_LLAMA_BUILD_DIR
  ? resolve(process.env.LEKHAN_LLAMA_BUILD_DIR)
  : join(cache, target + '-' + backend)
run('cmake', ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release',
  '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_BACKEND_DL=OFF',
  '-DLLAMA_OPENSSL=OFF', '-DLLAMA_BUILD_UI=OFF', '-DLLAMA_USE_PREBUILT_UI=OFF', '-DLLAMA_UI_GZIP=OFF',
  '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_APP=OFF',
  '-DGGML_METAL=' + (backend === 'metal' ? 'ON' : 'OFF'), '-DGGML_METAL_EMBED_LIBRARY=ON',
  '-DGGML_CUDA=' + (backend === 'cuda' ? 'ON' : 'OFF'), '-DGGML_VULKAN=' + (backend === 'vulkan' ? 'ON' : 'OFF'),
])
run('cmake', ['--build', build, '--config', 'Release', '--target', 'llama-server',
  '--parallel', String(Math.min(6, availableParallelism())),
])

const suffix = process.platform === 'win32' ? '.exe' : ''
const executable = ['bin', join('bin', 'Release'), join('Release', 'bin')]
  .map(directory => join(build, directory, 'llama-server' + suffix))
  .find(path => existsSync(path))
if (!executable) throw new Error('CMake did not produce llama-server.')
const binaries = join(root, 'src-tauri', 'binaries')
mkdirSync(binaries, { recursive: true })
copyFileSync(executable, join(binaries, 'lekhan-llama-server-' + target + suffix))
copyFileSync(join(source, 'LICENSE'), join(binaries, 'llama-license.txt'))

const [driver, , ...args] = process.argv
const npm = process.env.npm_execpath
if (!npm) throw new Error('Build with npm run desktop:package.')
run(driver, [npm, 'exec', '--', 'tauri', 'build', '--config',
  join(root, 'src-tauri', 'tauri.llama.conf.json'), ...args])
