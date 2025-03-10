import { SideBarStateContextShape } from 'containers/SideBarState'
import { GetCreatedMethod, MethodCreator } from 'driver/connect'
import { platform } from 'platforms'
import { Config } from 'utils/config/helper'
import * as DOMHelper from 'utils/DOMHelper'
import { isOpenInNewWindowClick, OperatingSystems, os } from 'utils/general'
import { loadWithPJAX } from 'utils/hooks/usePJAX'
import { VisibleNodes, VisibleNodesGenerator } from 'utils/VisibleNodesGenerator'

export type Props = {
  metaData: MetaData
  freeze: boolean
  accessToken: string | undefined
  config: Config
  catchNetworkErrors: <T>(fn: () => T) => Promise<T | undefined>
}

export type ConnectorState = {
  visibleNodesGenerator: VisibleNodesGenerator | null
  visibleNodes: VisibleNodes | null
  searchKey: string
  searched: boolean // derived state from searchKey, = !!searchKey
  defer: boolean

  handleKeyDown: GetCreatedMethod<typeof handleKeyDown>
  updateSearchKey: GetCreatedMethod<typeof updateSearchKey>
  onNodeClick: GetCreatedMethod<typeof onNodeClick>
  onFocusSearchBar: GetCreatedMethod<typeof onFocusSearchBar>
  setUpTree: GetCreatedMethod<typeof setUpTree>
  goTo: GetCreatedMethod<typeof goTo>
  expandTo: GetCreatedMethod<typeof expandTo>
}

function getVisibleParentNode(nodes: TreeNode[], focusedNode: TreeNode) {
  let index = nodes.findIndex(node => node.path === focusedNode.path) - 1
  while (index >= 0) {
    if (nodes[index].contents?.includes(focusedNode)) {
      return nodes[index]
    }
    --index
  }
}

type BoundMethodCreator<Args extends any[] = []> = MethodCreator<Props, ConnectorState, Args>

export const setUpTree: BoundMethodCreator<
  [
    { stateContext: SideBarStateContextShape } & Required<Pick<Props, 'metaData'>> & {
        config: Pick<Config, 'compressSingletonFolder' | 'accessToken'>
      },
    () => boolean,
  ]
> =
  dispatch =>
  ({ stateContext, metaData, config }, checker) => {
    const {
      props: { catchNetworkErrors },
    } = dispatch.get()

    catchNetworkErrors(async () => {
      const { userName, repoName, branchName } = metaData

      if (!checker()) return
      stateContext.onChange('tree-loading')

      const { root: treeRoot, defer = false } = await platform.getTreeData(
        {
          branchName,
          userName,
          repoName,
        },
        '/',
        true,
        config.accessToken,
      )

      if (!checker()) return
      stateContext.onChange('tree-rendering')
      dispatch.set({ defer })

      const visibleNodesGenerator = new VisibleNodesGenerator({
        root: treeRoot,
        compress: config.compressSingletonFolder,
        async getTreeData(path) {
          const { root } = await platform.getTreeData(metaData, path, false, config.accessToken)
          return root
        },
      })

      if (!checker()) return
      dispatch.set({ visibleNodesGenerator })

      visibleNodesGenerator.onUpdate(visibleNodes => {
        if (!checker()) return
        dispatch.set({ visibleNodes })
      })

      if (platform.shouldExpandAll?.()) {
        const unsubscribe = visibleNodesGenerator.onUpdate(visibleNodes => {
          unsubscribe()
          visibleNodes.nodes.forEach(node => {
            if (!checker()) return
            dispatch.call(toggleNodeExpansion, node, { recursive: true })
          })
        })
      } else {
        const targetPath = platform.getCurrentPath(metaData.branchName)
        if (targetPath && checker()) dispatch.call(goTo, targetPath)
      }

      if (!checker()) return
      stateContext.onChange('tree-rendered')
    })
  }

export const handleKeyDown: BoundMethodCreator<[React.KeyboardEvent<HTMLElement>]> =
  dispatch => event => {
    const {
      state: { searched, visibleNodes },
    } = dispatch.get()
    if (!visibleNodes) return
    const { nodes, focusedNode, expandedNodes } = visibleNodes
    function handleVerticalMove(index: number) {
      if (0 <= index && index < nodes.length) {
        DOMHelper.focusFileExplorer()
        dispatch.call(focusNode, nodes[index])
      } else {
        DOMHelper.focusSearchInput()
        dispatch.call(focusNode, null)
      }
    }

    const { key } = event
    // prevent document body scrolling if the keypress results in Gitako action
    let muteEvent = true
    if (focusedNode) {
      const focusedNodeIndex = nodes.findIndex(node => node.path === focusedNode.path)
      switch (key) {
        case 'ArrowUp':
          // focus on previous node
          handleVerticalMove(focusedNodeIndex - 1)
          break

        case 'ArrowDown':
          // focus on next node
          handleVerticalMove(focusedNodeIndex + 1)
          break

        case 'ArrowLeft':
          if (wouldBlockHistoryNavigation(event)) {
            muteEvent = false
            break
          }
          if (expandedNodes.has(focusedNode.path)) {
            dispatch.call(toggleNodeExpansion, focusedNode, { recursive: event.altKey })
          } else {
            // go forward to the start of the list, find the closest node with lower depth
            const parentNode = getVisibleParentNode(nodes, focusedNode)
            if (parentNode) {
              dispatch.call(focusNode, parentNode)
            }
          }
          break

        // consider the two keys as 'confirm' key
        case 'ArrowRight':
          if (wouldBlockHistoryNavigation(event)) {
            muteEvent = false
            break
          }
          // expand node or focus on first content node or redirect to file page
          if (focusedNode.type === 'tree') {
            if (expandedNodes.has(focusedNode.path)) {
              const nextNode = nodes[focusedNodeIndex + 1]
              if (focusedNode.contents?.includes(nextNode)) {
                dispatch.call(focusNode, nextNode)
              }
            } else {
              dispatch.call(toggleNodeExpansion, focusedNode, { recursive: event.altKey })
            }
          } else if (focusedNode.type === 'blob') {
            const focusedNodeElement = DOMHelper.findNodeElement(focusedNode, event.currentTarget)
            if (focusedNodeElement && focusedNode.url)
              loadWithPJAX(focusedNode.url, focusedNodeElement)
          } else if (focusedNode.type === 'commit') {
            window.open(focusedNode.url)
          }
          break
        case 'Enter':
          // expand node or redirect to file page
          if (searched) {
            dispatch.call(goTo, focusedNode.path.split('/'))
          } else {
            if (focusedNode.type === 'tree') {
              dispatch.call(toggleNodeExpansion, focusedNode, { recursive: event.altKey })
            } else if (focusedNode.type === 'blob') {
              const focusedNodeElement = DOMHelper.findNodeElement(focusedNode, event.currentTarget)
              if (focusedNodeElement && focusedNode.url)
                loadWithPJAX(focusedNode.url, focusedNodeElement)
            } else if (focusedNode.type === 'commit') {
              window.open(focusedNode.url)
            }
          }
          break
        default:
          muteEvent = false
      }
      if (muteEvent) {
        event.preventDefault()
      }
    } else {
      // now search input is focused
      if (nodes.length) {
        switch (key) {
          case 'ArrowDown':
            DOMHelper.focusFileExplorer()
            dispatch.call(focusNode, nodes[0])
            break
          case 'ArrowUp':
            DOMHelper.focusFileExplorer()
            dispatch.call(focusNode, nodes[nodes.length - 1])
            break
          default:
            muteEvent = false
        }
        if (muteEvent) {
          event.preventDefault()
        }
      }
    }
  }

export const onFocusSearchBar: BoundMethodCreator = dispatch => () => dispatch.call(focusNode, null)

export const updateSearchKey: BoundMethodCreator<[string]> = dispatch => searchKey => {
  dispatch.set({ searchKey, searched: searchKey !== '' })
}

export const goTo: BoundMethodCreator<[string[]]> = dispatch => path => {
  const {
    state: { visibleNodesGenerator },
  } = dispatch.get()
  if (!visibleNodesGenerator) return

  dispatch.call(updateSearchKey, '')
  visibleNodesGenerator.search(null)
  visibleNodesGenerator.onNextUpdate(() => {
    dispatch.call(expandTo, path)
  })
}

export const setExpand: BoundMethodCreator<[TreeNode, boolean]> =
  dispatch =>
  async (node, expand = false) => {
    const {
      state: { visibleNodesGenerator },
    } = dispatch.get()
    if (!visibleNodesGenerator) return

    await visibleNodesGenerator.setExpand(node, expand)
    dispatch.call(focusNode, node)
  }

export const toggleNodeExpansion: BoundMethodCreator<
  [
    TreeNode,
    {
      recursive?: boolean
    },
  ]
> =
  dispatch =>
  async (node, { recursive = false }) => {
    const {
      state: { visibleNodesGenerator },
    } = dispatch.get()
    if (!visibleNodesGenerator) return

    if (node.type === 'tree') {
      visibleNodesGenerator.focusNode(node)
      await visibleNodesGenerator.toggleExpand(node, recursive)
    }
  }

export const focusNode: BoundMethodCreator<[TreeNode | null]> =
  dispatch => (node: TreeNode | null) => {
    const {
      state: { visibleNodesGenerator },
    } = dispatch.get()
    if (!visibleNodesGenerator) return

    visibleNodesGenerator.focusNode(node)
  }

export const onNodeClick: BoundMethodCreator<
  [React.MouseEvent<HTMLElement, MouseEvent>, TreeNode]
> = dispatch => (event, node) => {
  switch (node.type) {
    case 'tree': {
      const {
        props: {
          config: { recursiveToggleFolder },
        },
      } = dispatch.get()
      const recursive =
        (recursiveToggleFolder === 'shift' && event.shiftKey) ||
        (recursiveToggleFolder === 'alt' && event.altKey)
      // recursive toggle action may conflict with browser default action
      // e.g. shift + click is the default open in new tab action on macOS
      // giving recursive toggle action higher priority than default action
      if (!recursive && isOpenInNewWindowClick(event)) return

      event.preventDefault()
      dispatch.call(toggleNodeExpansion, node, { recursive })
      break
    }
    case 'blob': {
      if (isOpenInNewWindowClick(event)) return

      dispatch.call(focusNode, node)
      if (node.url) {
        const isHashLink = node.url.includes('#')
        if (!isHashLink) {
          event.preventDefault()
          loadWithPJAX(node.url, event.currentTarget)
        }
      }
      break
    }
    case 'commit': {
      // pass event, open in new tab thanks to the target="_blank" on the anchor element
    }
  }
}

export const expandTo: BoundMethodCreator<[string[]]> = dispatch => async currentPath => {
  const {
    state: { visibleNodesGenerator },
  } = dispatch.get()
  if (!visibleNodesGenerator) return

  const nodeExpandedTo = await visibleNodesGenerator.expandTo(currentPath.join('/'))
  if (nodeExpandedTo) {
    visibleNodesGenerator.focusNode(nodeExpandedTo)
  }
}

function wouldBlockHistoryNavigation(event: React.KeyboardEvent) {
  // Cmd + left/right on macOS
  // Alt + left/right on other OSes
  return (
    (os === OperatingSystems.macOS && event.metaKey) ||
    (os !== OperatingSystems.macOS && event.altKey)
  )
}
