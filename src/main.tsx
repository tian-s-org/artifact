import { createRoot } from 'react-dom/client'
import './app.css'
import { CanvasPage } from './routes/CanvasPage'

/** 一个部署就是一块画布：没有路由，打开即画布 */
const root = document.getElementById('root')
if (!root) throw new Error('#root 不存在')

createRoot(root).render(<CanvasPage />)
