import './style.css'

/**
 * App entry point.
 *
 * Scaffold only: this will mount the splitter UI and wire it to `./split`.
 */
const app = document.querySelector<HTMLElement>('#app')

if (!app) {
  throw new Error('Missing #app mount point')
}
