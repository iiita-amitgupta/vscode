/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchConfiguration, IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { INativeWindowConfiguration } from 'vs/platform/windows/common/windows';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { URI } from 'vs/base/common/uri';

export interface INativeWorkbenchConfiguration extends IWorkbenchConfiguration, INativeWindowConfiguration { }

export interface INativeWorkbenchEnvironmentService extends IWorkbenchEnvironmentService, INativeEnvironmentService {

	readonly configuration: INativeWorkbenchConfiguration;

	readonly crashReporterDirectory?: string;
	readonly crashReporterId?: string;

	readonly execPath: string;
	readonly cliPath: string;

	readonly log?: string;
	readonly extHostLogsPath: URI;
}
