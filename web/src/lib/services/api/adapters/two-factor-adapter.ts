/**
 * Two-Factor Authentication (2FA) adapter.
 * Handles TOTP-based 2FA setup, verification, and management.
 * @module adapters/two-factor-adapter
 */

import { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

/**
 * Result of 2FA setup containing QR code and secret for authenticator apps.
 */
export interface TwoFactorSetupResult {
	/** Data URL of the QR code image for scanning */
	qr_code: string;
	/** The TOTP secret key (base32 encoded) */
	secret: string;
	/** The otpauth:// URI for manual entry in authenticator apps */
	uri: string;
}

/**
 * Result of enabling 2FA, includes backup codes for account recovery.
 */
export interface TwoFactorEnableResult {
	/** One-time backup codes for account recovery */
	backup_codes: string[];
	/** Optional success message */
	message?: string;
}

/**
 * Request payload for verifying a 2FA code.
 */
export interface TwoFactorVerifyRequest {
	/** The user ID to verify */
	user_id: string;
	/** The 6-digit TOTP code from authenticator app */
	code: string;
}

/**
 * Adapter for Two-Factor Authentication operations.
 * Supports TOTP-based authentication with QR code setup.
 *
 * @extends BaseAdapter
 * @example
 * ```typescript
 * const twoFactorAdapter = new TwoFactorAdapter({ session });
 *
 * // Setup 2FA
 * const setup = await twoFactorAdapter.setup2FA();
 * displayQRCode(setup.qr_code);
 *
 * // Enable with verification code
 * const result = await twoFactorAdapter.enable2FA('123456');
 * saveBackupCodes(result.backup_codes);
 * ```
 */
export class TwoFactorAdapter extends BaseAdapter {
	/**
	 * Creates a new TwoFactorAdapter instance.
	 * @param config - Configuration containing the authenticated session
	 */
	constructor(config: BaseAdapterConfig) {
		super(config);
	}

	/**
	 * Initiates 2FA setup by generating a TOTP secret and QR code.
	 * The QR code is customized with "Wayli" as the issuer name.
	 *
	 * @returns Promise resolving to setup data including QR code, secret, and URI
	 * @throws Error if 2FA setup fails
	 *
	 * @example
	 * ```typescript
	 * const setup = await twoFactorAdapter.setup2FA();
	 * // Display QR code for user to scan with authenticator app
	 * document.getElementById('qr').src = setup.qr_code;
	 * // Optionally show secret for manual entry
	 * console.log('Manual entry code:', setup.secret);
	 * ```
	 */
	async setup2FA(): Promise<TwoFactorSetupResult> {
		const { fluxbase } = await import('$lib/fluxbase');
		const QRCode = await import('qrcode');

		const { data, error } = await fluxbase.auth.setup2FA();

		if (error) {
			throw new Error(error.message || 'Failed to setup 2FA');
		}

		if (!data) {
			throw new Error('No setup data returned');
		}

		// Replace "Fluxbase" with "Wayli" in the TOTP URI
		const originalUri = data.totp.uri;
		const customUri = originalUri.replace(/Fluxbase/g, 'Wayli');

		// Generate a new QR code with the custom issuer name
		const customQrCode = await QRCode.default.toDataURL(customUri);

		return {
			qr_code: customQrCode,
			secret: data.totp.secret,
			uri: customUri
		};
	}

	/**
	 * Enables 2FA for the user after verification with a TOTP code.
	 * Returns backup codes that should be stored securely for account recovery.
	 *
	 * @param code - The 6-digit TOTP code from the authenticator app
	 * @returns Promise resolving to result with backup codes
	 * @throws Error if verification fails or 2FA cannot be enabled
	 *
	 * @example
	 * ```typescript
	 * const result = await twoFactorAdapter.enable2FA('123456');
	 * // Store backup codes securely
	 * result.backup_codes.forEach(code => console.log(code));
	 * ```
	 */
	async enable2FA(code: string): Promise<TwoFactorEnableResult> {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.enable2FA(code);

		if (error) {
			throw new Error(error.message || 'Failed to enable 2FA');
		}

		if (!data) {
			throw new Error('No response data returned');
		}

		if (!data.success) {
			throw new Error(data.message || 'Failed to enable 2FA');
		}

		return {
			backup_codes: data.backup_codes,
			message: data.message
		};
	}

	/**
	 * Disables 2FA for the user after password confirmation.
	 *
	 * @param password - The user's current password for confirmation
	 * @returns Promise resolving to success result
	 * @throws Error if password is incorrect or 2FA cannot be disabled
	 *
	 * @example
	 * ```typescript
	 * await twoFactorAdapter.disable2FA('currentPassword123');
	 * console.log('2FA has been disabled');
	 * ```
	 */
	async disable2FA(password: string) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.disable2FA(password);

		if (error) {
			throw new Error(error.message || 'Failed to disable 2FA');
		}

		if (!data) {
			throw new Error('No response data returned');
		}

		return {
			success: true,
			message: 'Two-factor authentication disabled successfully'
		};
	}

	/**
	 * Retrieves the current 2FA status for the user.
	 *
	 * @returns Promise resolving to object with totp_enabled boolean
	 * @throws Error if status cannot be retrieved
	 *
	 * @example
	 * ```typescript
	 * const status = await twoFactorAdapter.get2FAStatus();
	 * if (status.totp_enabled) {
	 *   console.log('2FA is enabled');
	 * }
	 * ```
	 */
	async get2FAStatus() {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.get2FAStatus();

		if (error) {
			throw new Error(error.message || 'Failed to get 2FA status');
		}

		if (!data) {
			throw new Error('No status data returned');
		}

		return {
			totp_enabled: data.totp && data.totp.length > 0
		};
	}

	/**
	 * Verifies a 2FA code during login or sensitive operations.
	 *
	 * @param request - Object containing user_id and the 6-digit code
	 * @returns Promise resolving to verification result
	 * @throws Error if verification fails
	 *
	 * @example
	 * ```typescript
	 * const result = await twoFactorAdapter.verify2FA({
	 *   user_id: 'user-uuid',
	 *   code: '123456'
	 * });
	 * ```
	 */
	async verify2FA(request: TwoFactorVerifyRequest) {
		const { fluxbase } = await import('$lib/fluxbase');

		const { data, error } = await fluxbase.auth.verify2FA(request);

		if (error) {
			throw new Error(error.message || 'Failed to verify 2FA code');
		}

		if (!data) {
			throw new Error('No verification response returned');
		}

		return data;
	}
}
