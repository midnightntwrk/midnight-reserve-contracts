# Multi-Mode Demo System Plan

## Overview

Transform the current web demo viewer into a comprehensive multi-mode system that supports creating, editing, and viewing demos. This system will be ideal for contract developers to test and demonstrate their contracts in action, with seamless transitions between modes and advanced features for rapid iteration.

## Current State Analysis

### What We Have ✅
- **View Mode**: Progressive demo execution with visual feedback
- **File Loading**: Support for `.demonb` files via file input and dropdown
- **Execution Engine**: Monadic runtime with scope persistence
- **Visual Feedback**: Operation detection, progress tracking, watcher panel
- **Backend Integration**: Full Blaze emulator integration

### What We're Missing ❌
- **Edit Mode**: No ability to create or modify demos
- **File Management**: No save/save-as functionality
- **Mode Switching**: No way to switch between view/edit modes
- **Session Management**: No "run to here" with clean sessions
- **Authoring Tools**: No visual demo builder

## Target Architecture

### Multi-Mode System Design

```
┌─────────────────┐    ┌─────────────────┐
│   VIEW MODE     │    │   EDIT MODE     │
│                 │    │                 │
│ • Execute demos │◄──►│ • Edit existing │
│ • Watch output  │    │ • Create new    │
│ • Track progress│    │ • Visual builder│
│ • Run to here   │    │ • Templates     │
│                 │    │ • Import/Export │
│                 │    │ • Save changes  │
│                 │    │ • Preview       │
└─────────────────┘    └─────────────────┘
```

### Mode Transitions

1. **View → Edit**: "Edit Demo" button in view mode
2. **Edit → View**: "Preview" or "Run Demo" button in edit mode
3. **Any → Edit (New)**: "New Demo" button in global toolbar

## Phase 1: Core Multi-Mode Infrastructure

### 1.1 Mode Management System

**Goal**: Implement the foundation for switching between modes

**Components**:
- `ModeManager` class to handle mode transitions
- Global toolbar with mode indicators
- Mode-specific UI state management
- URL-based mode persistence

**Implementation**:
```typescript
enum DemoMode {
  VIEW = 'view',
  EDIT = 'edit'
}

class ModeManager {
  private currentMode: DemoMode = DemoMode.VIEW;
  private modeHandlers: Record<DemoMode, ModeHandler>;
  
  switchMode(newMode: DemoMode, context?: ModeContext): void;
  getCurrentMode(): DemoMode;
  isModeAvailable(mode: DemoMode): boolean;
}
```

**Files to Create**:
- `src/demo-interpreter/modes/ModeManager.ts`
- `src/demo-interpreter/modes/types.ts`
- `src/demo-interpreter/modes/ViewMode.ts`
- `src/demo-interpreter/modes/EditMode.ts`

### 1.2 Global Toolbar

**Goal**: Create a persistent toolbar that works across all modes

**Features**:
- Mode indicator and switcher
- File management (New, Open, Save, Save As)
- Session management (New Session, Run to Here)
- Demo metadata display

**Implementation**:
```html
<div class="global-toolbar">
  <div class="mode-indicator">
    <span class="mode-badge view">View</span>
    <span class="mode-badge edit">Edit</span>
  </div>
  
  <div class="file-controls">
    <button id="newDemo">New Demo</button>
    <button id="openDemo">Open</button>
    <button id="saveDemo">Save</button>
    <button id="saveAsDemo">Save As</button>
  </div>
  
  <div class="session-controls">
    <button id="newSession">New Session</button>
    <button id="runToHere">Run to Here</button>
  </div>
  
  <div class="demo-info">
    <span id="demoName">Untitled Demo</span>
    <span id="demoStatus">Ready</span>
  </div>
</div>
```

### 1.3 File Management System

**Goal**: Implement comprehensive file operations

**Features**:
- Save current demo to `.demonb` format
- Save As with custom filename
- Auto-save functionality
- File validation and error handling
- Recent files list

**Implementation**:
```typescript
class FileManager {
  private currentFile: DemoFile | null = null;
  private autoSaveInterval: number | null = null;
  
  async saveDemo(demo: Demo, filename?: string): Promise<void>;
  async loadDemo(file: File | string): Promise<Demo>;
  async exportDemo(demo: Demo, format: ExportFormat): Promise<void>;
  getRecentFiles(): string[];
  setAutoSave(enabled: boolean, intervalMs?: number): void;
}
```

## Phase 2: Edit Mode Implementation

### 2.1 Edit Mode UI

**Goal**: Create a Jupyter notebook-like editing interface for demos

**Features**:
- Inline editing of markdown and code blocks
- Add new blocks/stanzas between existing ones
- Drag-and-drop reordering of blocks and stanzas
- Block type selection (markdown, code, stanza)
- Real-time preview
- Validation feedback

**Implementation**:
```html
<div class="edit-mode">
  <div class="edit-toolbar">
    <button id="newDemo">New Demo</button>
    <button id="loadTemplate">Load Template</button>
    <button id="previewDemo">Preview</button>
    <button id="saveChanges">Save</button>
  </div>
  
  <div class="notebook-content">
    <div class="block-list">
      <!-- Editable blocks with add buttons between them -->
      <div class="block markdown-block">
        <div class="block-content">...</div>
        <div class="block-actions">
          <button class="add-block-btn">+</button>
          <button class="add-stanza-btn">+ Stanza</button>
        </div>
      </div>
      
      <div class="block code-block">
        <div class="block-content">...</div>
        <div class="block-actions">
          <button class="add-block-btn">+</button>
          <button class="add-stanza-btn">+ Stanza</button>
        </div>
      </div>
    </div>
  </div>
  
  <div class="edit-preview">
    <!-- Live preview of changes -->
  </div>
</div>
```

### 2.2 Inline Editors

**Goal**: Implement Jupyter notebook-style inline editing

**Components**:
- **Markdown Editor**: Rich text editing with live markdown preview
- **Code Editor**: Syntax-highlighted JavaScript editor with autocomplete
- **Block Management**: Add/remove/reorder blocks and stanzas

**Implementation**:
```typescript
class NotebookEditor {
  private blocks: Block[] = [];
  private currentBlock: Block | null = null;
  
  addBlock(type: BlockType, position: number): Block;
  removeBlock(index: number): void;
  moveBlock(fromIndex: number, toIndex: number): void;
  addStanza(position: number): Stanza;
  startEdit(blockIndex: number): void;
  saveEdit(blockIndex: number): void;
}

class MarkdownEditor {
  private element: HTMLElement;
  private previewElement: HTMLElement;
  
  startEdit(): void;
  updatePreview(): void;
  saveEdit(): string;
}

class CodeEditor {
  private element: HTMLElement;
  private monacoEditor: any; // Monaco editor instance
  
  startEdit(): void;
  getAutocompleteSuggestions(): Suggestion[];
  validateCode(): ValidationResult[];
  saveEdit(): string;
}
```

### 2.3 Block and Stanza Management

**Goal**: Implement Jupyter notebook-style block management with stanza support

**Features**:
- **Add Blocks**: Insert new blocks between existing ones
- **Block Types**: Markdown, Code, Stanza (group of blocks)
- **Drag-and-Drop**: Reorder blocks and stanzas
- **Block Actions**: Add, remove, duplicate, collapse
- **Stanza Grouping**: Group related blocks into stanzas

**Implementation**:
```typescript
interface Block {
  id: string;
  type: 'markdown' | 'code' | 'stanza';
  content: string;
  position: number;
  stanzaId?: string; // For blocks within stanzas
}

interface Stanza {
  id: string;
  name: string;
  blocks: Block[];
  position: number;
}

class BlockManager {
  private blocks: Block[] = [];
  private stanzas: Stanza[] = [];
  
  addBlock(type: BlockType, position: number, stanzaId?: string): Block;
  removeBlock(blockId: string): void;
  moveBlock(blockId: string, newPosition: number): void;
  addStanza(position: number): Stanza;
  moveStanza(stanzaId: string, newPosition: number): void;
  groupBlocksIntoStanza(blockIds: string[], stanzaName: string): Stanza;
  ungroupStanza(stanzaId: string): Block[];
}
```

### 2.4 Block Type Selection

**Goal**: Provide intuitive block type selection like Jupyter notebooks

**Features**:
- **Block Type Menu**: Dropdown to select block type when adding
- **Quick Add Buttons**: "+" buttons between blocks for quick insertion
- **Template Blocks**: Pre-filled blocks for common patterns
- **Smart Suggestions**: Suggest block types based on context

**Implementation**:
```html
<div class="block-type-selector">
  <div class="block-type-menu">
    <div class="block-type markdown">
      <span class="icon">📝</span>
      <span class="label">Markdown</span>
      <span class="description">Documentation and explanations</span>
    </div>
    <div class="block-type code">
      <span class="icon">💻</span>
      <span class="label">Code</span>
      <span class="description">JavaScript code execution</span>
    </div>
    <div class="block-type stanza">
      <span class="icon">📦</span>
      <span class="label">Stanza</span>
      <span class="description">Group related blocks</span>
    </div>
  </div>
</div>

<div class="add-block-buttons">
  <button class="add-block-btn" data-position="0">+</button>
  <button class="add-block-btn" data-position="1">+</button>
  <!-- More buttons between blocks -->
</div>
```

### 2.5 Template System

**Goal**: Provide pre-built templates for common demo patterns

**Templates**:
- **Wallet Demo**: Basic wallet creation and transfers
- **Contract Deployment**: Deploy and interact with contracts
- **NFT Demo**: Mint and transfer NFTs
- **DeFi Demo**: Liquidity pool interactions
- **Custom Template**: User-defined templates

**Implementation**:
```typescript
interface DemoTemplate {
  name: string;
  description: string;
  category: TemplateCategory;
  demo: Demo;
  variables: TemplateVariable[];
}

class TemplateManager {
  private templates: DemoTemplate[] = [];
  
  getTemplates(category?: TemplateCategory): DemoTemplate[];
  applyTemplate(template: DemoTemplate, variables: Record<string, any>): Demo;
  saveTemplate(demo: Demo, name: string, category: TemplateCategory): void;
}
```

### 2.6 Import/Export System

**Goal**: Support importing from various formats and exporting to different targets

**Formats**:
- **Import**: `.demonb`, `.json`, markdown files, code snippets
- **Export**: `.demonb`, `.json`, markdown, HTML presentation, PDF

**Implementation**:
```typescript
class ImportExportManager {
  async importFromFile(file: File): Promise<Demo>;
  async importFromMarkdown(markdown: string): Promise<Demo>;
  async importFromCode(code: string): Promise<Demo>;
  
  async exportToDemonb(demo: Demo): Promise<string>;
  async exportToMarkdown(demo: Demo): Promise<string>;
  async exportToHtml(demo: Demo): Promise<string>;
  async exportToPdf(demo: Demo): Promise<Blob>;
}
```

## Phase 3: Advanced Features

### 3.1 Session Management

**Goal**: Implement advanced session control for testing and debugging

**Features**:
- **Run to Here**: Execute demo up to a specific point
- **Clean Session**: Start fresh session for testing
- **Session Snapshots**: Save and restore session state
- **Debug Mode**: Step-by-step execution with inspection

**Implementation**:
```typescript
class SessionManager {
  private currentSession: Session | null = null;
  private sessionHistory: Session[] = [];
  
  async newSession(): Promise<Session>;
  async runToStanza(stanzaIndex: number): Promise<void>;
  async runToBlock(blockIndex: number): Promise<void>;
  saveSnapshot(name: string): void;
  restoreSnapshot(name: string): Promise<void>;
  getSessionState(): SessionState;
}
```

### 3.2 Live Collaboration

**Goal**: Enable real-time collaboration on demos

**Features**:
- **Shared Editing**: Multiple users can edit simultaneously
- **Comments**: Add comments to specific blocks
- **Version Control**: Track changes and revert
- **Sharing**: Share demos via URL or export

**Implementation**:
```typescript
class CollaborationManager {
  private collaborators: Collaborator[] = [];
  private comments: Comment[] = [];
  private changeHistory: Change[] = [];
  
  joinSession(sessionId: string, userId: string): Promise<void>;
  leaveSession(): void;
  addComment(blockId: string, text: string): Comment;
  applyChange(change: Change): Promise<void>;
  getChangeHistory(): Change[];
}
```

### 3.3 Advanced Editor Features

**Goal**: Provide professional-grade editing capabilities

**Features**:
- **Auto-completion**: Smart suggestions for monadic functions
- **Error Detection**: Real-time validation of demo code
- **Refactoring**: Rename variables, extract functions
- **Search/Replace**: Global search across demo content
- **Keyboard Shortcuts**: Power-user shortcuts

**Implementation**:
```typescript
class AdvancedEditor {
  private autocompleteProvider: AutocompleteProvider;
  private errorDetector: ErrorDetector;
  private refactoringEngine: RefactoringEngine;
  
  getAutocompleteSuggestions(context: CompletionContext): Suggestion[];
  validateCode(code: string): ValidationResult[];
  refactorVariable(oldName: string, newName: string): RefactoringResult;
  searchContent(query: string): SearchResult[];
}
```

## Phase 4: Integration and Polish

### 4.1 Backend Integration

**Goal**: Extend the backend to support new features

**New Endpoints**:
```typescript
// File management
POST /api/demo/save
GET /api/demo/load/:filename
POST /api/demo/export

// Session management
POST /api/session/run-to/:stanzaIndex
POST /api/session/snapshot
POST /api/session/restore/:snapshotId

// Collaboration
POST /api/collaboration/join
POST /api/collaboration/comment
POST /api/collaboration/sync
```

### 4.2 Performance Optimization

**Goal**: Ensure smooth performance with large demos

**Optimizations**:
- **Virtual Scrolling**: Only render visible stanzas
- **Lazy Loading**: Load demo content on demand
- **Caching**: Cache compiled demos and templates
- **Background Processing**: Process heavy operations in web workers

### 4.3 Accessibility and UX

**Goal**: Ensure the system is accessible and user-friendly

**Features**:
- **Keyboard Navigation**: Full keyboard support
- **Screen Reader**: ARIA labels and descriptions
- **High Contrast**: Accessibility-friendly themes
- **Responsive Design**: Works on all screen sizes
- **Tutorial System**: Interactive onboarding

## Implementation Timeline

### Phase 1: Core Infrastructure (2-3 weeks)
- Mode management system
- Global toolbar
- File management
- Basic mode switching

### Phase 2: Edit Mode (4-5 weeks)
- Jupyter notebook-style edit mode UI
- Inline editing with block type selection
- Drag-and-drop block/stanza reordering
- Template system and import/export

### Phase 3: Advanced Features (3-4 weeks)
- Session management
- Live collaboration
- Advanced editor features
- Performance optimization

### Phase 4: Integration and Polish (2-3 weeks)
- Backend integration
- Accessibility improvements
- Testing and bug fixes
- Documentation

**Total Timeline**: 11-15 weeks

## Success Criteria

### Technical Success
- [ ] Seamless mode switching without data loss
- [ ] Real-time editing with instant preview
- [ ] Robust file management with auto-save
- [ ] "Run to here" functionality works correctly
- [ ] Performance remains smooth with large demos

### User Experience Success
- [ ] Intuitive interface for all user types
- [ ] Fast iteration cycle for contract developers
- [ ] Professional presentation capabilities
- [ ] Collaboration features enhance productivity
- [ ] Accessibility compliance

### Business Success
- [ ] Reduces time to create contract demos
- [ ] Improves demo quality and consistency
- [ ] Enables better contract testing workflows
- [ ] Supports educational and presentation use cases
- [ ] Provides competitive advantage in contract development

## Risk Assessment

### High Risk
- **Complexity**: Multi-mode system adds significant complexity
- **Performance**: Large demos may impact performance
- **State Management**: Complex state transitions between modes
- **File Format**: Need to maintain backward compatibility

### Medium Risk
- **Browser Compatibility**: Advanced features may not work in all browsers
- **Real-time Collaboration**: WebSocket implementation complexity
- **User Adoption**: Learning curve for new features
- **Backend Changes**: Significant backend modifications required

### Low Risk
- **UI/UX Design**: Well-established patterns available
- **File Operations**: Standard web APIs for file handling
- **Template System**: Straightforward implementation
- **Documentation**: Clear requirements and specifications

## Next Steps

1. **Start with Phase 1**: Implement core mode management
2. **Create Prototype**: Build minimal viable multi-mode system
3. **User Testing**: Validate with contract developers
4. **Iterative Development**: Build features incrementally
5. **Performance Monitoring**: Track performance metrics throughout development

---

**Status**: 🚀 Ready to begin Phase 1 implementation
