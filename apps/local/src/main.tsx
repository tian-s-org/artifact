import { createRoot } from 'react-dom/client'
import './app.css'
import { CanvasPage } from './routes/CanvasPage'
import { Hub } from './routes/Hub'

/** 只有两个视图，不引路由库：/ 是项目列表，/p/<id> 是画布 */
function App() {
  const match = /^\/p\/([a-z0-9][a-z0-9-]{0,63})\/?$/.exec(window.location.pathname)
  const projectId = match?.[1]
  return projectId ? <CanvasPage projectId={projectId} /> : <Hub />
}

const root = document.getElementById('root')
if (!root) throw new Error('#root 不存在')

createRoot(root).render(<App />)
