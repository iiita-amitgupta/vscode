/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import Event, {Emitter} from 'vs/base/common/event';
import {Disposable} from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import * as platform from 'vs/base/common/platform';
import {Extensions, IConfigurationRegistry, IConfigurationNode} from 'vs/platform/configuration/common/configurationRegistry';
import {Registry} from 'vs/platform/platform';
import {DefaultConfig, DEFAULT_INDENTATION, DEFAULT_TRIM_AUTO_WHITESPACE, GOLDEN_LINE_HEIGHT_RATIO} from 'vs/editor/common/config/defaultConfig';
import * as editorCommon from 'vs/editor/common/editorCommon';
import {EditorLayoutProvider} from 'vs/editor/common/viewLayout/editorLayoutProvider';
import {ScrollbarVisibility} from 'vs/base/browser/ui/scrollbar/scrollableElementOptions';

// TODO@Alex: investigate if it is better to stick to 31 bits (see smi = SMall Integer)
// See https://thibaultlaurens.github.io/javascript/2013/04/29/how-the-v8-engine-works/#tagged-values
/**
 * MAX_INT that fits in 32 bits
 */
const MAX_SAFE_INT = 0x7fffffff;
/**
 * MIN_INT that fits in 32 bits
 */
const MIN_SAFE_INT = -0x80000000;

export interface IEditorZoom {
	onDidChangeZoomLevel:Event<number>;
	getZoomLevel(): number;
	setZoomLevel(zoomLevel:number): void;
}

export const EditorZoom: IEditorZoom = new class {

	private _zoomLevel: number = 0;

	private _onDidChangeZoomLevel: Emitter<number> = new Emitter<number>();
	public onDidChangeZoomLevel:Event<number> = this._onDidChangeZoomLevel.event;

	public getZoomLevel(): number {
		return this._zoomLevel;
	}

	public setZoomLevel(zoomLevel:number): void {
		zoomLevel = Math.min(Math.max(-9, zoomLevel), 9);
		if (this._zoomLevel === zoomLevel) {
			return;
		}

		this._zoomLevel = zoomLevel;
		this._onDidChangeZoomLevel.fire(this._zoomLevel);
	}
};

/**
 * Control what pressing Tab does.
 * If it is false, pressing Tab or Shift-Tab will be handled by the editor.
 * If it is true, pressing Tab or Shift-Tab will move the browser focus.
 * Defaults to false.
 */
export interface ITabFocus {
	onDidChangeTabFocus:Event<boolean>;
	getTabFocusMode(): boolean;
	setTabFocusMode(tabFocusMode:boolean): void;
}

export const TabFocus: ITabFocus = new class {
	private _tabFocus: boolean = false;

	private _onDidChangeTabFocus: Emitter<boolean> = new Emitter<boolean>();
	public onDidChangeTabFocus:Event<boolean> = this._onDidChangeTabFocus.event;

	public getTabFocusMode(): boolean {
		return this._tabFocus;
	}

	public setTabFocusMode(tabFocusMode:boolean): void {
		if (this._tabFocus === tabFocusMode) {
			return;
		}

		this._tabFocus = tabFocusMode;
		this._onDidChangeTabFocus.fire(this._tabFocus);
	}
};

/**
 * Experimental screen reader support toggle
 */
export class GlobalScreenReaderNVDA {

	private static _value = false;
	private static _onChange = new Emitter<boolean>();
	public static onChange: Event<boolean> = GlobalScreenReaderNVDA._onChange.event;

	public static getValue(): boolean {
		return this._value;
	}

	public static setValue(value:boolean): void {
		if (this._value === value) {
			return;
		}
		this._value = value;
		this._onChange.fire(this._value);
	}
}

export class ConfigurationWithDefaults {

	private _editor:editorCommon.IEditorOptions;

	constructor(options:editorCommon.IEditorOptions) {
		this._editor = <editorCommon.IEditorOptions>objects.clone(DefaultConfig.editor);

		this._mergeOptionsIn(options);
	}

	public getEditorOptions(): editorCommon.IEditorOptions {
		return this._editor;
	}

	private _mergeOptionsIn(newOptions:editorCommon.IEditorOptions): void {
		this._editor = objects.mixin(this._editor, newOptions || {});
	}

	public updateOptions(newOptions:editorCommon.IEditorOptions): void {
		// Apply new options
		this._mergeOptionsIn(newOptions);
	}
}

class InternalEditorOptionsHelper {

	constructor() {
	}

	public static createInternalEditorOptions(
		outerWidth:number, outerHeight:number,
		opts:editorCommon.IEditorOptions,
		fontInfo: editorCommon.FontInfo,
		editorClassName:string,
		isDominatedByLongLines:boolean,
		lineCount: number,
		canUseTranslate3d: boolean
	): editorCommon.InternalEditorOptions {

		let wrappingColumn = toInteger(opts.wrappingColumn, -1);

		let stopRenderingLineAfter:number;
		if (typeof opts.stopRenderingLineAfter !== 'undefined') {
			stopRenderingLineAfter = toInteger(opts.stopRenderingLineAfter, -1);
		} else if (wrappingColumn >= 0) {
			stopRenderingLineAfter = -1;
		} else {
			stopRenderingLineAfter = 10000;
		}

		let mouseWheelScrollSensitivity = toFloat(opts.mouseWheelScrollSensitivity, 1);
		let scrollbar = this._sanitizeScrollbarOpts(opts.scrollbar, mouseWheelScrollSensitivity);

		let glyphMargin = toBoolean(opts.glyphMargin);
		let lineNumbers = opts.lineNumbers;
		let lineNumbersMinChars = toInteger(opts.lineNumbersMinChars, 1);
		let lineDecorationsWidth = toInteger(opts.lineDecorationsWidth, 0);
		if (opts.folding) {
			lineDecorationsWidth += 16;
		}
		let layoutInfo = EditorLayoutProvider.compute({
			outerWidth: outerWidth,
			outerHeight: outerHeight,
			showGlyphMargin: glyphMargin,
			lineHeight: fontInfo.lineHeight,
			showLineNumbers: !!lineNumbers,
			lineNumbersMinChars: lineNumbersMinChars,
			lineDecorationsWidth: lineDecorationsWidth,
			maxDigitWidth: fontInfo.maxDigitWidth,
			lineCount: lineCount,
			verticalScrollbarWidth: scrollbar.verticalScrollbarSize,
			horizontalScrollbarHeight: scrollbar.horizontalScrollbarSize,
			scrollbarArrowSize: scrollbar.arrowSize,
			verticalScrollbarHasArrows: scrollbar.verticalHasArrows
		});

		if (isDominatedByLongLines && wrappingColumn > 0) {
			// Force viewport width wrapping if model is dominated by long lines
			wrappingColumn = 0;
		}

		let bareWrappingInfo: { isViewportWrapping: boolean; wrappingColumn: number; };
		if (wrappingColumn === 0) {
			// If viewport width wrapping is enabled
			bareWrappingInfo = {
				isViewportWrapping: true,
				wrappingColumn: Math.max(1, Math.floor((layoutInfo.contentWidth - layoutInfo.verticalScrollbarWidth) / fontInfo.typicalHalfwidthCharacterWidth))
			};
		} else if (wrappingColumn > 0) {
			// Wrapping is enabled
			bareWrappingInfo = {
				isViewportWrapping: false,
				wrappingColumn: wrappingColumn
			};
		} else {
			bareWrappingInfo = {
				isViewportWrapping: false,
				wrappingColumn: -1
			};
		}
		let wrappingInfo = new editorCommon.EditorWrappingInfo({
			isViewportWrapping: bareWrappingInfo.isViewportWrapping,
			wrappingColumn: bareWrappingInfo.wrappingColumn,
			wrappingIndent: wrappingIndentFromString(opts.wrappingIndent),
			wordWrapBreakBeforeCharacters: String(opts.wordWrapBreakBeforeCharacters),
			wordWrapBreakAfterCharacters: String(opts.wordWrapBreakAfterCharacters),
			wordWrapBreakObtrusiveCharacters: String(opts.wordWrapBreakObtrusiveCharacters),
		});

		let readOnly = toBoolean(opts.readOnly);

		let tabFocusMode = TabFocus.getTabFocusMode();
		if (readOnly) {
			tabFocusMode = true;
		}

		let viewInfo = new editorCommon.InternalEditorViewOptions({
			theme: opts.theme,
			canUseTranslate3d: canUseTranslate3d,
			experimentalScreenReader: toBoolean(opts.experimentalScreenReader),
			rulers: toSortedIntegerArray(opts.rulers),
			ariaLabel: String(opts.ariaLabel),
			lineNumbers: lineNumbers,
			selectOnLineNumbers: toBoolean(opts.selectOnLineNumbers),
			glyphMargin: glyphMargin,
			revealHorizontalRightPadding: toInteger(opts.revealHorizontalRightPadding, 0),
			roundedSelection: toBoolean(opts.roundedSelection),
			overviewRulerLanes: toInteger(opts.overviewRulerLanes, 0, 3),
			cursorBlinking: opts.cursorBlinking,
			mouseWheelZoom: toBoolean(opts.mouseWheelZoom),
			cursorStyle: cursorStyleFromString(opts.cursorStyle),
			hideCursorInOverviewRuler: toBoolean(opts.hideCursorInOverviewRuler),
			scrollBeyondLastLine: toBoolean(opts.scrollBeyondLastLine),
			editorClassName: editorClassName,
			stopRenderingLineAfter: stopRenderingLineAfter,
			renderWhitespace: toBoolean(opts.renderWhitespace),
			renderControlCharacters: toBoolean(opts.renderControlCharacters),
			renderIndentGuides: toBoolean(opts.renderIndentGuides),
			scrollbar: scrollbar,
		});

		let contribInfo = new editorCommon.EditorContribOptions({
			selectionClipboard: toBoolean(opts.selectionClipboard),
			hover: toBoolean(opts.hover),
			contextmenu: toBoolean(opts.contextmenu),
			quickSuggestions: toBoolean(opts.quickSuggestions),
			quickSuggestionsDelay: toInteger(opts.quickSuggestionsDelay),
			parameterHints: toBoolean(opts.parameterHints),
			iconsInSuggestions: toBoolean(opts.iconsInSuggestions),
			formatOnType: toBoolean(opts.formatOnType),
			suggestOnTriggerCharacters: toBoolean(opts.suggestOnTriggerCharacters),
			acceptSuggestionOnEnter: toBoolean(opts.acceptSuggestionOnEnter),
			selectionHighlight: toBoolean(opts.selectionHighlight),
			referenceInfos: toBoolean(opts.referenceInfos),
			folding: toBoolean(opts.folding),
		});

		return new editorCommon.InternalEditorOptions({
			lineHeight: fontInfo.lineHeight, // todo -> duplicated in styling
			readOnly: readOnly,
			wordSeparators: String(opts.wordSeparators),
			autoClosingBrackets: toBoolean(opts.autoClosingBrackets),
			useTabStops: toBoolean(opts.useTabStops),
			tabFocusMode: tabFocusMode,
			layoutInfo: layoutInfo,
			fontInfo: fontInfo,
			viewInfo: viewInfo,
			wrappingInfo: wrappingInfo,
			contribInfo: contribInfo,
		});
	}

	private static _sanitizeScrollbarOpts(raw:editorCommon.IEditorScrollbarOptions, mouseWheelScrollSensitivity:number): editorCommon.InternalEditorScrollbarOptions {

		var visibilityFromString = (visibility: string) => {
			switch (visibility) {
				case 'hidden':
					return ScrollbarVisibility.Hidden;
				case 'visible':
					return ScrollbarVisibility.Visible;
				default:
					return ScrollbarVisibility.Auto;
			}
		};

		let horizontalScrollbarSize = toIntegerWithDefault(raw.horizontalScrollbarSize, 10);
		let verticalScrollbarSize = toIntegerWithDefault(raw.verticalScrollbarSize, 14);
		return new editorCommon.InternalEditorScrollbarOptions({
			vertical: visibilityFromString(raw.vertical),
			horizontal: visibilityFromString(raw.horizontal),

			arrowSize: toIntegerWithDefault(raw.arrowSize, 11),
			useShadows: toBooleanWithDefault(raw.useShadows, true),

			verticalHasArrows: toBooleanWithDefault(raw.verticalHasArrows, false),
			horizontalHasArrows: toBooleanWithDefault(raw.horizontalHasArrows, false),

			horizontalScrollbarSize: horizontalScrollbarSize,
			horizontalSliderSize: toIntegerWithDefault(raw.horizontalSliderSize, horizontalScrollbarSize),

			verticalScrollbarSize: verticalScrollbarSize,
			verticalSliderSize: toIntegerWithDefault(raw.verticalSliderSize, verticalScrollbarSize),

			handleMouseWheel: toBooleanWithDefault(raw.handleMouseWheel, true),
			mouseWheelScrollSensitivity: mouseWheelScrollSensitivity
		});
	}
}

function toBoolean(value:any): boolean {
	return value === 'false' ? false : Boolean(value);
}

function toBooleanWithDefault(value:any, defaultValue:boolean): boolean {
	if (typeof value === 'undefined') {
		return defaultValue;
	}
	return toBoolean(value);
}

function toFloat(source: any, defaultValue: number): number {
	let r = parseFloat(source);
	if (isNaN(r)) {
		r = defaultValue;
	}
	return r;
}

function toInteger(source:any, minimum:number = MIN_SAFE_INT, maximum:number = MAX_SAFE_INT): number {
	let r = parseInt(source, 10);
	if (isNaN(r)) {
		r = 0;
	}
	r = Math.max(minimum, r);
	r = Math.min(maximum, r);
	return r | 0;
}

function toSortedIntegerArray(source:any): number[] {
	if (!Array.isArray(source)) {
		return [];
	}
	let arrSource = <any[]>source;
	let r = arrSource.map(el => toInteger(el));
	r.sort();
	return r;
}

function wrappingIndentFromString(wrappingIndent:string): editorCommon.WrappingIndent {
	if (wrappingIndent === 'indent') {
		return editorCommon.WrappingIndent.Indent;
	} else if (wrappingIndent === 'same') {
		return editorCommon.WrappingIndent.Same;
	} else {
		return editorCommon.WrappingIndent.None;
	}
}

function cursorStyleFromString(cursorStyle:string): editorCommon.TextEditorCursorStyle {
	if (cursorStyle === 'line') {
		return editorCommon.TextEditorCursorStyle.Line;
	} else if (cursorStyle === 'block') {
		return editorCommon.TextEditorCursorStyle.Block;
	} else if (cursorStyle === 'underline') {
		return editorCommon.TextEditorCursorStyle.Underline;
	}
	return editorCommon.TextEditorCursorStyle.Line;
}

function toIntegerWithDefault(source:any, defaultValue:number): number {
	if (typeof source === 'undefined') {
		return defaultValue;
	}
	return toInteger(source);
}

interface IValidatedIndentationOptions {
	tabSizeIsAuto: boolean;
	tabSize: number;
	insertSpacesIsAuto: boolean;
	insertSpaces: boolean;
}

export interface IElementSizeObserver {
	startObserving(): void;
	observe(dimension?:editorCommon.IDimension): void;
	dispose(): void;
	getWidth(): number;
	getHeight(): number;
}

export abstract class CommonEditorConfiguration extends Disposable implements editorCommon.IConfiguration {

	public editor:editorCommon.InternalEditorOptions;
	public editorClone:editorCommon.InternalEditorOptions;

	protected _configWithDefaults:ConfigurationWithDefaults;
	protected _elementSizeObserver: IElementSizeObserver;
	private _isDominatedByLongLines:boolean;
	private _lineCount:number;

	private _onDidChange = this._register(new Emitter<editorCommon.IConfigurationChangedEvent>());
	public onDidChange: Event<editorCommon.IConfigurationChangedEvent> = this._onDidChange.event;

	constructor(options:editorCommon.IEditorOptions, elementSizeObserver: IElementSizeObserver = null) {
		super();
		this._configWithDefaults = new ConfigurationWithDefaults(options);
		this._elementSizeObserver = elementSizeObserver;
		this._isDominatedByLongLines = false;
		this._lineCount = 1;
		this.editor = this._computeInternalOptions();
		this.editorClone = this.editor.clone();
		this._register(EditorZoom.onDidChangeZoomLevel(_ => this._recomputeOptions()));
		this._register(TabFocus.onDidChangeTabFocus(_ => this._recomputeOptions()));
	}

	public dispose(): void {
		super.dispose();
	}

	protected _recomputeOptions(): void {
		this._setOptions(this._computeInternalOptions());
	}

	private _setOptions(newOptions:editorCommon.InternalEditorOptions): void {
		if (this.editor && this.editor.equals(newOptions)) {
			return;
		}

		let changeEvent = this.editor.createChangeEvent(newOptions);
		this.editor = newOptions;
		this.editorClone = this.editor.clone();
		this._onDidChange.fire(changeEvent);
	}

	public getRawOptions(): editorCommon.IEditorOptions {
		return this._configWithDefaults.getEditorOptions();
	}

	private _computeInternalOptions(): editorCommon.InternalEditorOptions {
		let opts = this._configWithDefaults.getEditorOptions();

		let editorClassName = this._getEditorClassName(opts.theme, toBoolean(opts.fontLigatures));
		let fontFamily = String(opts.fontFamily) || DefaultConfig.editor.fontFamily;
		let fontSize = toInteger(opts.fontSize, 0, 100) || DefaultConfig.editor.fontSize;

		let lineHeight = toInteger(opts.lineHeight, 0, 150);
		if (lineHeight === 0) {
			lineHeight = Math.round(GOLDEN_LINE_HEIGHT_RATIO * fontSize);
		}
		let editorZoomLevelMultiplier = 1 + (EditorZoom.getZoomLevel() * 0.1);
		fontSize *= editorZoomLevelMultiplier;
		lineHeight *= editorZoomLevelMultiplier;

		let disableTranslate3d = toBoolean(opts.disableTranslate3d);
		let canUseTranslate3d = this._getCanUseTranslate3d();
		if (disableTranslate3d) {
			canUseTranslate3d = false;
		}

		return InternalEditorOptionsHelper.createInternalEditorOptions(
			this.getOuterWidth(),
			this.getOuterHeight(),
			opts,
			this.readConfiguration(new editorCommon.BareFontInfo({
				fontFamily: fontFamily,
				fontSize: fontSize,
				lineHeight: lineHeight
			})),
			editorClassName,
			this._isDominatedByLongLines,
			this._lineCount,
			canUseTranslate3d
		);
	}

	public updateOptions(newOptions:editorCommon.IEditorOptions): void {
		this._configWithDefaults.updateOptions(newOptions);
		this._recomputeOptions();
	}

	public setIsDominatedByLongLines(isDominatedByLongLines:boolean): void {
		this._isDominatedByLongLines = isDominatedByLongLines;
		this._recomputeOptions();
	}

	public setLineCount(lineCount:number): void {
		this._lineCount = lineCount;
		this._recomputeOptions();
	}

	protected abstract _getEditorClassName(theme:string, fontLigatures:boolean): string;

	protected abstract getOuterWidth(): number;

	protected abstract getOuterHeight(): number;

	protected abstract _getCanUseTranslate3d(): boolean;

	protected abstract readConfiguration(styling: editorCommon.BareFontInfo): editorCommon.FontInfo;
}

/**
 * Helper to update Monaco Editor Settings from configurations service.
 */
export class EditorConfiguration {
	public static EDITOR_SECTION = 'editor';
	public static DIFF_EDITOR_SECTION = 'diffEditor';

	/**
	 * Ask the provided configuration service to apply its configuration to the provided editor.
	 */
	public static apply(config:any, editor?:editorCommon.IEditor): void;
	public static apply(config:any, editor?:editorCommon.IEditor[]): void;
	public static apply(config:any, editorOrArray?:any): void {
		if (!config) {
			return;
		}

		let editors:editorCommon.IEditor[] = editorOrArray;
		if (!Array.isArray(editorOrArray)) {
			editors = [editorOrArray];
		}

		for (let i = 0; i < editors.length; i++) {
			let editor = editors[i];

			// Editor Settings (Code Editor, Diff, Terminal)
			if (editor && typeof editor.updateOptions === 'function') {
				let type = editor.getEditorType();
				if (type !== editorCommon.EditorType.ICodeEditor && type !== editorCommon.EditorType.IDiffEditor) {
					continue;
				}

				let editorConfig = config[EditorConfiguration.EDITOR_SECTION];
				if (type === editorCommon.EditorType.IDiffEditor) {
					let diffEditorConfig = config[EditorConfiguration.DIFF_EDITOR_SECTION];
					if (diffEditorConfig) {
						if (!editorConfig) {
							editorConfig = diffEditorConfig;
						} else {
							editorConfig = objects.mixin(editorConfig, diffEditorConfig);
						}
					}
				}

				if (editorConfig) {
					delete editorConfig.readOnly; // Prevent someone from making editor readonly
					editor.updateOptions(editorConfig);
				}
			}
		}
	}
}

let configurationRegistry = <IConfigurationRegistry>Registry.as(Extensions.Configuration);
let editorConfiguration:IConfigurationNode = {
	'id': 'editor',
	'order': 5,
	'type': 'object',
	'title': nls.localize('editorConfigurationTitle', "Editor"),
	'properties' : {
		'editor.fontFamily' : {
			'type': 'string',
			'default': DefaultConfig.editor.fontFamily,
			'description': nls.localize('fontFamily', "Controls the font family.")
		},
		'editor.fontSize' : {
			'type': 'number',
			'default': DefaultConfig.editor.fontSize,
			'description': nls.localize('fontSize', "Controls the font size.")
		},
		'editor.lineHeight' : {
			'type': 'number',
			'default': DefaultConfig.editor.lineHeight,
			'description': nls.localize('lineHeight', "Controls the line height.")
		},
		'editor.lineNumbers' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.lineNumbers,
			'description': nls.localize('lineNumbers', "Controls visibility of line numbers")
		},
		'editor.glyphMargin' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.glyphMargin,
			'description': nls.localize('glyphMargin', "Controls visibility of the glyph margin")
		},
		'editor.rulers' : {
			'type': 'array',
			'items': {
				'type': 'number'
			},
			'default': DefaultConfig.editor.rulers,
			'description': nls.localize('rulers', "Columns at which to show vertical rulers")
		},
		'editor.wordSeparators' : {
			'type': 'string',
			'default': DefaultConfig.editor.wordSeparators,
			'description': nls.localize('wordSeparators', "Characters that will be used as word separators when doing word related navigations or operations")
		},
		'editor.tabSize' : {
			'type': 'number',
			'default': DEFAULT_INDENTATION.tabSize,
			'minimum': 1,
			'description': nls.localize('tabSize', "The number of spaces a tab is equal to."),
			'errorMessage': nls.localize('tabSize.errorMessage', "Expected 'number'. Note that the value \"auto\" has been replaced by the `editor.detectIndentation` setting.")
		},
		'editor.insertSpaces' : {
			'type': 'boolean',
			'default': DEFAULT_INDENTATION.insertSpaces,
			'description': nls.localize('insertSpaces', "Insert spaces when pressing Tab."),
			'errorMessage': nls.localize('insertSpaces.errorMessage', "Expected 'boolean'. Note that the value \"auto\" has been replaced by the `editor.detectIndentation` setting.")
		},
		'editor.detectIndentation' : {
			'type': 'boolean',
			'default': DEFAULT_INDENTATION.detectIndentation,
			'description': nls.localize('detectIndentation', "When opening a file, `editor.tabSize` and `editor.insertSpaces` will be detected based on the file contents.")
		},
		'editor.roundedSelection' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.roundedSelection,
			'description': nls.localize('roundedSelection', "Controls if selections have rounded corners")
		},
		'editor.scrollBeyondLastLine' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.scrollBeyondLastLine,
			'description': nls.localize('scrollBeyondLastLine', "Controls if the editor will scroll beyond the last line")
		},
		'editor.wrappingColumn' : {
			'type': 'integer',
			'default': DefaultConfig.editor.wrappingColumn,
			'minimum': -1,
			'description': nls.localize('wrappingColumn', "Controls after how many characters the editor will wrap to the next line. Setting this to 0 turns on viewport width wrapping (word wrapping). Setting this to -1 forces the editor to never wrap.")
		},
		'editor.wrappingIndent' : {
			'type': 'string',
			'enum': ['none', 'same', 'indent'],
			'default': DefaultConfig.editor.wrappingIndent,
			'description': nls.localize('wrappingIndent', "Controls the indentation of wrapped lines. Can be one of 'none', 'same' or 'indent'.")
		},
		'editor.mouseWheelScrollSensitivity' : {
			'type': 'number',
			'default': DefaultConfig.editor.mouseWheelScrollSensitivity,
			'description': nls.localize('mouseWheelScrollSensitivity', "A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events")
		},
		'editor.quickSuggestions' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.quickSuggestions,
			'description': nls.localize('quickSuggestions', "Controls if quick suggestions should show up or not while typing")
		},
		'editor.quickSuggestionsDelay' : {
			'type': 'integer',
			'default': DefaultConfig.editor.quickSuggestionsDelay,
			'minimum': 0,
			'description': nls.localize('quickSuggestionsDelay', "Controls the delay in ms after which quick suggestions will show up")
		},
		'editor.parameterHints' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.parameterHints,
			'description': nls.localize('parameterHints', "Enables parameter hints")
		},
		'editor.autoClosingBrackets' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.autoClosingBrackets,
			'description': nls.localize('autoClosingBrackets', "Controls if the editor should automatically close brackets after opening them")
		},
		'editor.formatOnType' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.formatOnType,
			'description': nls.localize('formatOnType', "Controls if the editor should automatically format the line after typing")
		},
		'editor.suggestOnTriggerCharacters' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.suggestOnTriggerCharacters,
			'description': nls.localize('suggestOnTriggerCharacters', "Controls if suggestions should automatically show up when typing trigger characters")
		},
		'editor.acceptSuggestionOnEnter' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.acceptSuggestionOnEnter,
			'description': nls.localize('acceptSuggestionOnEnter', "Controls if suggestions should be accepted 'Enter' - in addition to 'Tab'. Helps to avoid ambiguity between inserting new lines or accepting suggestions.")
		},
		'editor.selectionHighlight' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.selectionHighlight,
			'description': nls.localize('selectionHighlight', "Controls whether the editor should highlight similar matches to the selection")
		},
		'editor.overviewRulerLanes' : {
			'type': 'integer',
			'default': 3,
			'description': nls.localize('overviewRulerLanes', "Controls the number of decorations that can show up at the same position in the overview ruler")
		},
		'editor.cursorBlinking' : {
			'type': 'string',
			'enum': ['blink', 'visible', 'hidden'],
			'default': DefaultConfig.editor.cursorBlinking,
			'description': nls.localize('cursorBlinking', "Controls the cursor blinking animation, accepted values are 'blink', 'visible', and 'hidden'")
		},
		'editor.mouseWheelZoom': {
			'type': 'boolean',
			'default': DefaultConfig.editor.mouseWheelZoom,
			'description': nls.localize('mouseWheelZoom', "Zoom the font of the editor when using mouse wheel and holding Ctrl")
		},
		'editor.cursorStyle' : {
			'type': 'string',
			'enum': ['block', 'line'],
			'default': DefaultConfig.editor.cursorStyle,
			'description': nls.localize('cursorStyle', "Controls the cursor style, accepted values are 'block' and 'line'")
		},
		'editor.fontLigatures' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.fontLigatures,
			'description': nls.localize('fontLigatures', "Enables font ligatures")
		},
		'editor.hideCursorInOverviewRuler' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.hideCursorInOverviewRuler,
			'description': nls.localize('hideCursorInOverviewRuler', "Controls if the cursor should be hidden in the overview ruler.")
		},
		'editor.renderWhitespace': {
			'type': 'boolean',
			default: DefaultConfig.editor.renderWhitespace,
			description: nls.localize('renderWhitespace', "Controls whether the editor should render whitespace characters")
		},
		'editor.renderControlCharacters': {
			'type': 'boolean',
			default: DefaultConfig.editor.renderControlCharacters,
			description: nls.localize('renderControlCharacters', "Controls whether the editor should render control characters")
		},
		'editor.renderIndentGuides': {
			'type': 'boolean',
			default: DefaultConfig.editor.renderIndentGuides,
			description: nls.localize('renderIndentGuides', "Controls whether the editor should render indent guides")
		},
		'editor.referenceInfos' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.referenceInfos,
			'description': nls.localize('referenceInfos', "Controls if the editor shows reference information for the modes that support it")
		},
		'editor.folding' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.folding,
			'description': nls.localize('folding', "Controls whether the editor has code folding enabled")
		},
		'editor.useTabStops' : {
			'type': 'boolean',
			'default': DefaultConfig.editor.useTabStops,
			'description': nls.localize('useTabStops', "Inserting and deleting whitespace follows tab stops")
		},
		'editor.trimAutoWhitespace' : {
			'type': 'boolean',
			'default': DEFAULT_TRIM_AUTO_WHITESPACE,
			'description': nls.localize('trimAutoWhitespace', "Remove trailing auto inserted whitespace")
		},
		'editor.stablePeek' : {
			'type': 'boolean',
			'default': false,
			'description': nls.localize('stablePeek', "Keep peek editors open even when double clicking their content or when hitting Escape.")
		},
		'diffEditor.renderSideBySide' : {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('sideBySide', "Controls if the diff editor shows the diff side by side or inline")
		},
		'diffEditor.ignoreTrimWhitespace' : {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('ignoreTrimWhitespace', "Controls if the diff editor shows changes in leading or trailing whitespace as diffs")
		}
	}
};

if (platform.isLinux) {
	editorConfiguration['properties']['editor.selectionClipboard'] = {
		'type': 'boolean',
		'default': DefaultConfig.editor.selectionClipboard,
		'description': nls.localize('selectionClipboard', "Controls if the Linux primary clipboard should be supported.")
	};
}

configurationRegistry.registerConfiguration(editorConfiguration);