/**
 * Tools Module - Clawdbot-style agent tools
 */

export { createExecTool } from './exec';
export type { ExecTool, ExecOptions, ExecResult } from './exec';

export { createWebSearchTool, formatSearchResults } from './web-search';
export type { WebSearchTool, SearchOptions, SearchResult, SearchResponse } from './web-search';

export { createWebFetchTool } from './web-fetch';
export type { WebFetchTool, FetchOptions, FetchResult } from './web-fetch';

export { createSessionTools, formatSessionList } from './sessions';
export type { SessionTools, SessionInfo, HistoryEntry, SendOptions, SendResult } from './sessions';

export { createImageTool } from './image';
export type { ImageTool, ImageSource, AnalyzeOptions, AnalysisResult } from './image';

export { createMessageTool } from './message';
export type {
  MessageTool,
  MessageAction,
  ReactionAction,
  ThreadAction,
  PollAction,
  PinAction,
  EditAction,
  DeleteAction,
} from './message';

export { createBrowserTool } from './browser';
export type { BrowserTool, BrowserConfig, ScreenshotOptions, ClickOptions, PageInfo } from './browser';

export { createCanvasTool, CanvasTemplates } from './canvas';
export type { CanvasTool, CanvasState, CanvasSnapshot, CanvasContentType } from './canvas';

export { createNodesTool } from './nodes';
export type {
  NodesTool,
  DeviceNode,
  NodeType,
  NodeCapability,
  CameraSnapResult,
  ScreenRecordResult,
  LocationResult,
  SystemRunResult,
} from './nodes';
