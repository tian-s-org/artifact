import { createRoot } from 'react-dom/client'
import './app.css'
import { CanvasList } from './routes/CanvasList'
import { CanvasPage } from './routes/CanvasPage'

/** `/c/<id>` 是一块画布（链接即权限）；其它路径是「我的画布」列表 */
const match = /^\/c\/([a-f0-9]{24})\/?$/.exec(window.location.pathname)

const root = document.getElementById('root')
if (!root) throw new Error('#root 不存在')

createRoot(root).render(match?.[1] ? <CanvasPage canvasId={match[1]} /> : <CanvasList />)
