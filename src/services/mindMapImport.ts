import type { DocumentItem } from '../types/domain'

type ImportableDocument = Pick<DocumentItem, 'title' | 'content'>

export const standaloneDocumentToMindMapGraph = (item: ImportableDocument, rootId = `root-${Date.now()}`) => {
  const sourceNodes = Array.isArray(item.content?.nodes) ? item.content.nodes : []
  const normalizedNodes = sourceNodes.map((node: any, index: number) => ({
    ...node,
    id: String(node?.id || `topic-${index + 1}`)
  }))
  const ids = new Set(normalizedNodes.map((node: any) => node.id))
  const nodes = normalizedNodes.map((node: any, index: number) => {
    const parentId = node.parent_id && ids.has(String(node.parent_id)) ? String(node.parent_id) : rootId
    return {
      id: node.id,
      type: 'topic',
      position: { x: 380 + (index % 3) * 260, y: 100 + index * 100 },
      data: {
        label: String(node.label || '新主题'),
        color: node.color,
        parent_id: parentId,
        priority: node.priority ?? null,
        marker: node.marker ?? null,
        fontSize: Number(node.fontSize) || 28
      }
    }
  })
  return {
    nodes: [
      { id: rootId, type: 'root', position: { x: 70, y: 220 }, data: { label: String(item.content?.root || item.title || '中心主题'), type: 'root' } },
      ...nodes
    ],
    edges: nodes.map(node => ({ id: `${node.data.parent_id}-${node.id}`, source: node.data.parent_id, target: node.id })),
    layoutStyle: 'right'
  }
}

export const mindMapGraphSummary = (graph: Record<string, any>) => {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const previewLabels = nodes
    .map((node: any) => String(node?.data?.label || node?.label || '').trim())
    .filter(Boolean)
    .slice(0, 4)
  return {
    nodeCount: Math.max(1, nodes.length),
    previewLabels: previewLabels.length ? previewLabels : ['中心主题']
  }
}
