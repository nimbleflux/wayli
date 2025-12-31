import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceAdapter, type ServiceAdapterConfig } from '$lib/services/api/service-adapter';

// Mock the fluxbase module
const mockFluxbase = {
	auth: {
		getUser: vi.fn(),
		updateUser: vi.fn(),
		setup2FA: vi.fn(),
		enable2FA: vi.fn(),
		disable2FA: vi.fn(),
		get2FAStatus: vi.fn(),
		verify2FA: vi.fn()
	},
	from: vi.fn(),
	functions: {
		invoke: vi.fn()
	},
	storage: {
		from: vi.fn()
	},
	jobs: {
		list: vi.fn(),
		submit: vi.fn(),
		get: vi.fn(),
		cancel: vi.fn()
	},
	admin: {
		settings: {
			app: {
				get: vi.fn(),
				getSetting: vi.fn(),
				setSetting: vi.fn(),
				listSettings: vi.fn(),
				getSecretSetting: vi.fn(),
				setSecretSetting: vi.fn(),
				listSecretSettings: vi.fn(),
				deleteSecretSetting: vi.fn(),
				enableSignup: vi.fn(),
				disableSignup: vi.fn(),
				setEmailVerificationRequired: vi.fn(),
				setPasswordMinLength: vi.fn(),
				setPasswordComplexity: vi.fn(),
				setSessionSettings: vi.fn(),
				setFeature: vi.fn(),
				setRateLimiting: vi.fn()
			},
			email: {
				get: vi.fn(),
				update: vi.fn()
			},
			system: {
				get: vi.fn()
			}
		},
		ai: {
			listProviders: vi.fn(),
			createProvider: vi.fn(),
			updateProvider: vi.fn()
		}
	}
};

vi.mock('$lib/fluxbase', () => ({
	fluxbase: mockFluxbase
}));

// Mock QRCode module
vi.mock('qrcode', () => ({
	default: {
		toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqrcode')
	}
}));

// Helper to create chainable query mock
function createQueryMock(resolvedData: any = null, resolvedError: any = null) {
	const mock: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		upsert: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		gt: vi.fn().mockReturnThis(),
		gte: vi.fn().mockReturnThis(),
		lt: vi.fn().mockReturnThis(),
		lte: vi.fn().mockReturnThis(),
		like: vi.fn().mockReturnThis(),
		ilike: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		not: vi.fn().mockReturnThis(),
		or: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		range: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
		maybeSingle: vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError })
	};

	// Make the mock itself resolve for queries without .single()
	mock.then = vi.fn((resolve: any) =>
		resolve({
			data: Array.isArray(resolvedData) ? resolvedData : [resolvedData],
			error: resolvedError
		})
	);

	return mock;
}

describe('ServiceAdapter', () => {
	let adapter: ServiceAdapter;
	const mockSession = {
		user: {
			id: 'test-user-id',
			email: 'test@example.com'
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		adapter = new ServiceAdapter({ session: mockSession } as ServiceAdapterConfig);

		// Default mock for getUser
		mockFluxbase.auth.getUser.mockResolvedValue({
			data: {
				user: {
					id: 'test-user-id',
					email: 'test@example.com',
					user_metadata: {
						first_name: 'Test',
						last_name: 'User',
						full_name: 'Test User'
					}
				}
			},
			error: null
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('callApi', () => {
		it('should convert slash-separated endpoints to hyphen-separated', async () => {
			mockFluxbase.functions.invoke.mockResolvedValue({
				data: { success: true, data: { result: 'test' } },
				error: null
			});

			await adapter.callApi('trips/locations');

			expect(mockFluxbase.functions.invoke).toHaveBeenCalledWith(
				'trips-locations',
				expect.objectContaining({ method: 'GET' })
			);
		});

		it('should add query parameters to URL', async () => {
			mockFluxbase.functions.invoke.mockResolvedValue({
				data: { success: true },
				error: null
			});

			await adapter.callApi('test', { params: { foo: 'bar', baz: 'qux' } });

			expect(mockFluxbase.functions.invoke).toHaveBeenCalledWith(
				'test?foo=bar&baz=qux',
				expect.any(Object)
			);
		});

		it('should throw error when edge function fails', async () => {
			mockFluxbase.functions.invoke.mockResolvedValue({
				data: null,
				error: { message: 'Function error' }
			});

			await expect(adapter.callApi('test')).rejects.toThrow('Function error');
		});

		it('should unwrap nested data structure', async () => {
			mockFluxbase.functions.invoke.mockResolvedValue({
				data: { success: true, data: { nested: 'value' } },
				error: null
			});

			const result = await adapter.callApi('test');

			expect(result).toEqual({ nested: 'value' });
		});

		it('should return raw data when not nested', async () => {
			mockFluxbase.functions.invoke.mockResolvedValue({
				data: { raw: 'value' },
				error: null
			});

			const result = await adapter.callApi('test');

			expect(result).toEqual({ raw: 'value' });
		});

		it('should include body in POST requests', async () => {
			mockFluxbase.functions.invoke.mockResolvedValue({
				data: { success: true },
				error: null
			});

			await adapter.callApi('test', { method: 'POST', body: { foo: 'bar' } });

			expect(mockFluxbase.functions.invoke).toHaveBeenCalledWith(
				'test',
				expect.objectContaining({
					method: 'POST',
					body: { foo: 'bar' }
				})
			);
		});
	});

	describe('Profile Operations', () => {
		describe('getProfile', () => {
			it('should fetch and combine auth and profile data', async () => {
				const queryMock = createQueryMock({
					id: 'test-user-id',
					first_name: 'Database',
					last_name: 'Name',
					full_name: 'Database Name'
				});
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getProfile();

				expect(mockFluxbase.from).toHaveBeenCalledWith('user_profiles');
				expect(result.email).toBe('test@example.com');
				expect(result.first_name).toBe('Database');
			});

			it('should fall back to auth metadata when profile fields are empty', async () => {
				const queryMock = createQueryMock({
					id: 'test-user-id',
					first_name: '',
					last_name: '',
					full_name: ''
				});
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getProfile();

				expect(result.first_name).toBe('Test');
				expect(result.last_name).toBe('User');
			});

			it('should throw error when user is not authenticated', async () => {
				mockFluxbase.auth.getUser.mockResolvedValue({
					data: { user: null },
					error: null
				});

				await expect(adapter.getProfile()).rejects.toThrow('User not authenticated');
			});

			it('should throw error when profile fetch fails', async () => {
				const queryMock = createQueryMock(null, { message: 'Database error' });
				mockFluxbase.from.mockReturnValue(queryMock);

				await expect(adapter.getProfile()).rejects.toThrow('Database error');
			});
		});

		describe('updateProfile', () => {
			it('should update profile fields in database', async () => {
				const queryMock = createQueryMock();
				mockFluxbase.from.mockReturnValue(queryMock);

				await adapter.updateProfile({ first_name: 'Updated' });

				expect(mockFluxbase.from).toHaveBeenCalledWith('user_profiles');
				expect(queryMock.update).toHaveBeenCalledWith({ first_name: 'Updated' });
			});

			it('should update email via auth when provided', async () => {
				const queryMock = createQueryMock();
				mockFluxbase.from.mockReturnValue(queryMock);
				mockFluxbase.auth.updateUser.mockResolvedValue({ error: null });

				await adapter.updateProfile({ email: 'new@example.com', first_name: 'Test' });

				expect(mockFluxbase.auth.updateUser).toHaveBeenCalledWith({
					email: 'new@example.com'
				});
			});

			it('should throw error when email update fails', async () => {
				mockFluxbase.auth.updateUser.mockResolvedValue({
					error: { message: 'Email update failed' }
				});

				await expect(adapter.updateProfile({ email: 'invalid@example.com' })).rejects.toThrow(
					'Failed to update email'
				);
			});
		});

		describe('getPreferences', () => {
			it('should fetch user preferences from database', async () => {
				const queryMock = createQueryMock({
					id: 'test-user-id',
					theme: 'dark',
					language: 'en'
				});
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getPreferences();

				expect(mockFluxbase.from).toHaveBeenCalledWith('user_preferences');
				expect(result.theme).toBe('dark');
			});
		});

		describe('updatePreferences', () => {
			it('should update preferences with timestamp', async () => {
				const queryMock = createQueryMock();
				mockFluxbase.from.mockReturnValue(queryMock);

				await adapter.updatePreferences({ theme: 'light' });

				expect(queryMock.update).toHaveBeenCalledWith(
					expect.objectContaining({
						theme: 'light',
						updated_at: expect.any(String)
					})
				);
			});
		});

		describe('updatePassword', () => {
			it('should update password via auth', async () => {
				mockFluxbase.auth.updateUser.mockResolvedValue({ error: null });

				const result = await adapter.updatePassword('newpassword123');

				expect(mockFluxbase.auth.updateUser).toHaveBeenCalledWith({
					password: 'newpassword123'
				});
				expect(result.message).toBe('Password updated successfully');
			});

			it('should throw error when password update fails', async () => {
				mockFluxbase.auth.updateUser.mockResolvedValue({
					error: { message: 'Password too weak' }
				});

				await expect(adapter.updatePassword('weak')).rejects.toThrow('Password too weak');
			});
		});
	});

	describe('Two-Factor Authentication', () => {
		describe('setup2FA', () => {
			it('should setup 2FA and return QR code with custom issuer', async () => {
				mockFluxbase.auth.setup2FA.mockResolvedValue({
					data: {
						id: 'factor-id',
						type: 'totp',
						totp: {
							qr_code: 'original-qr',
							secret: 'secret123',
							uri: 'otpauth://totp/Fluxbase:test@example.com?secret=secret123&issuer=Fluxbase'
						}
					},
					error: null
				});

				const result = await adapter.setup2FA();

				expect(result.qr_code).toContain('data:image/png;base64');
				expect(result.secret).toBe('secret123');
				expect(result.uri).toContain('Wayli');
				expect(result.uri).not.toContain('Fluxbase');
			});

			it('should throw error when setup fails', async () => {
				mockFluxbase.auth.setup2FA.mockResolvedValue({
					data: null,
					error: { message: '2FA setup failed' }
				});

				await expect(adapter.setup2FA()).rejects.toThrow('2FA setup failed');
			});

			it('should throw error when no setup data returned', async () => {
				mockFluxbase.auth.setup2FA.mockResolvedValue({
					data: null,
					error: null
				});

				await expect(adapter.setup2FA()).rejects.toThrow('No setup data returned');
			});
		});

		describe('enable2FA', () => {
			it('should enable 2FA and return backup codes', async () => {
				mockFluxbase.auth.enable2FA.mockResolvedValue({
					data: {
						success: true,
						backup_codes: ['code1', 'code2', 'code3'],
						message: 'Enabled'
					},
					error: null
				});

				const result = await adapter.enable2FA('123456');

				expect(result.backup_codes).toEqual(['code1', 'code2', 'code3']);
			});

			it('should throw error when verification code is invalid', async () => {
				mockFluxbase.auth.enable2FA.mockResolvedValue({
					data: { success: false, message: 'Invalid code' },
					error: null
				});

				await expect(adapter.enable2FA('000000')).rejects.toThrow('Invalid code');
			});
		});

		describe('disable2FA', () => {
			it('should disable 2FA with password', async () => {
				mockFluxbase.auth.disable2FA.mockResolvedValue({
					data: { id: 'factor-id' },
					error: null
				});

				const result = await adapter.disable2FA('password123');

				expect(result.success).toBe(true);
				expect(mockFluxbase.auth.disable2FA).toHaveBeenCalledWith('password123');
			});
		});

		describe('get2FAStatus', () => {
			it('should return totp_enabled true when factors exist', async () => {
				mockFluxbase.auth.get2FAStatus.mockResolvedValue({
					data: {
						all: [{ type: 'totp' }],
						totp: [{ id: 'factor-id' }]
					},
					error: null
				});

				const result = await adapter.get2FAStatus();

				expect(result.totp_enabled).toBe(true);
			});

			it('should return totp_enabled false when no factors', async () => {
				mockFluxbase.auth.get2FAStatus.mockResolvedValue({
					data: { all: [], totp: [] },
					error: null
				});

				const result = await adapter.get2FAStatus();

				expect(result.totp_enabled).toBe(false);
			});
		});

		describe('verify2FA', () => {
			it('should verify 2FA code and return tokens', async () => {
				mockFluxbase.auth.verify2FA.mockResolvedValue({
					data: {
						access_token: 'access-token',
						refresh_token: 'refresh-token'
					},
					error: null
				});

				const result = await adapter.verify2FA({
					user_id: 'test-user-id',
					code: '123456'
				});

				expect(result.access_token).toBe('access-token');
			});
		});
	});

	describe('Trips Operations', () => {
		describe('getTrips', () => {
			it('should fetch completed trips for user', async () => {
				const trips = [
					{ id: 'trip1', title: 'Trip 1', status: 'completed' },
					{ id: 'trip2', title: 'Trip 2', status: 'completed' }
				];
				const queryMock = createQueryMock(trips);
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getTrips();

				expect(mockFluxbase.from).toHaveBeenCalledWith('trips');
				expect(queryMock.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
				expect(queryMock.eq).toHaveBeenCalledWith('status', 'completed');
				expect(result).toEqual(trips);
			});

			it('should apply search filter when provided', async () => {
				const queryMock = createQueryMock([]);
				mockFluxbase.from.mockReturnValue(queryMock);

				await adapter.getTrips({ search: 'Paris' });

				expect(queryMock.or).toHaveBeenCalled();
			});

			it('should apply pagination', async () => {
				const queryMock = createQueryMock([]);
				mockFluxbase.from.mockReturnValue(queryMock);

				await adapter.getTrips({ limit: 10, offset: 20 });

				expect(queryMock.range).toHaveBeenCalledWith(20, 29);
			});
		});

		describe('createTrip', () => {
			it('should create a new trip with required fields', async () => {
				const newTrip = {
					id: 'new-trip-id',
					title: 'New Trip',
					user_id: 'test-user-id',
					status: 'planned'
				};
				const queryMock = createQueryMock(newTrip);
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.createTrip({ title: 'New Trip' });

				expect(queryMock.insert).toHaveBeenCalledWith(
					expect.objectContaining({
						title: 'New Trip',
						user_id: 'test-user-id'
					})
				);
				expect(result.id).toBe('new-trip-id');
			});

			it('should throw error when title is missing', async () => {
				await expect(adapter.createTrip({})).rejects.toThrow('Missing required field: title');
			});

			it('should calculate distance when dates are provided', async () => {
				const newTrip = {
					id: 'new-trip-id',
					title: 'New Trip',
					start_date: '2024-01-01',
					end_date: '2024-01-05',
					metadata: {}
				};

				// Mock for insert
				const insertMock = createQueryMock(newTrip);
				// Mock for distance calculation
				const distanceMock = createQueryMock([{ distance: 100 }, { distance: 200 }]);
				// Mock for update
				const updateMock = createQueryMock();

				mockFluxbase.from
					.mockReturnValueOnce(insertMock) // create
					.mockReturnValueOnce(distanceMock) // calculate distance
					.mockReturnValueOnce(updateMock); // update with distance

				const result = await adapter.createTrip({
					title: 'New Trip',
					start_date: '2024-01-01',
					end_date: '2024-01-05'
				});

				expect(result).toBeDefined();
			});
		});

		describe('updateTrip', () => {
			it('should update an existing trip', async () => {
				const existingTrip = { id: 'trip-id' };
				const updatedTrip = {
					id: 'trip-id',
					title: 'Updated Title',
					start_date: null,
					end_date: null
				};

				const fetchMock = createQueryMock(existingTrip);
				const updateMock = createQueryMock(updatedTrip);

				mockFluxbase.from.mockReturnValueOnce(fetchMock).mockReturnValueOnce(updateMock);

				const result = await adapter.updateTrip({
					id: 'trip-id',
					title: 'Updated Title'
				});

				expect(result.title).toBe('Updated Title');
			});

			it('should throw error when trip id is missing', async () => {
				await expect(adapter.updateTrip({ title: 'No ID' })).rejects.toThrow(
					'Missing required field: id'
				);
			});

			it('should throw error when trip not found', async () => {
				const fetchMock = createQueryMock(null, { message: 'Not found' });
				mockFluxbase.from.mockReturnValue(fetchMock);

				await expect(adapter.updateTrip({ id: 'nonexistent' })).rejects.toThrow('Trip not found');
			});
		});

		describe('getSuggestedTrips', () => {
			it('should fetch pending trips with count', async () => {
				const trips = [{ id: 'trip1', status: 'pending' }];
				const queryMock = createQueryMock(trips);
				queryMock.then = vi.fn((resolve: any) => resolve({ data: trips, error: null, count: 1 }));
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getSuggestedTrips();

				expect(queryMock.eq).toHaveBeenCalledWith('status', 'pending');
				expect(result.trips).toEqual(trips);
			});
		});

		describe('clearAllSuggestedTrips', () => {
			it('should delete pending and rejected trips', async () => {
				const queryMock = createQueryMock();
				queryMock.then = vi.fn((resolve: any) => resolve({ data: null, error: null }));
				mockFluxbase.from.mockReturnValue(queryMock);

				await adapter.clearAllSuggestedTrips();

				expect(queryMock.delete).toHaveBeenCalled();
				expect(queryMock.in).toHaveBeenCalledWith('status', ['pending', 'rejected']);
			});
		});

		describe('rejectSuggestedTrips', () => {
			it('should update trip status to rejected', async () => {
				const queryMock = createQueryMock([{ id: 'trip1', status: 'rejected' }]);
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.rejectSuggestedTrips(['trip1', 'trip2']);

				expect(queryMock.update).toHaveBeenCalledWith(
					expect.objectContaining({ status: 'rejected' })
				);
				expect(result.rejected).toBeDefined();
			});
		});
	});

	describe('Jobs Operations', () => {
		describe('getJobs', () => {
			it('should fetch jobs from API', async () => {
				const jobs = [{ id: 'job1', job_name: 'data-export', status: 'completed' }];
				mockFluxbase.jobs.list.mockResolvedValue({ data: jobs, error: null });

				const result = await adapter.getJobs();

				expect(mockFluxbase.jobs.list).toHaveBeenCalledWith(
					expect.objectContaining({ namespace: 'wayli' })
				);
				expect(result).toEqual(jobs);
			});

			it('should filter by job type', async () => {
				const jobs = [
					{ id: 'job1', job_name: 'data-export' },
					{ id: 'job2', job_name: 'data-import' }
				];
				mockFluxbase.jobs.list.mockResolvedValue({ data: jobs, error: null });

				const result = await adapter.getJobs({ type: 'data-export' });

				expect(result).toHaveLength(1);
				expect(result[0].job_name).toBe('data-export');
			});
		});

		describe('createJob', () => {
			it('should submit a new job', async () => {
				const newJob = { id: 'new-job-id', job_name: 'data-export' };
				mockFluxbase.jobs.submit.mockResolvedValue({ data: newJob, error: null });

				const result = await adapter.createJob({ type: 'data-export', data: { format: 'json' } });

				expect(mockFluxbase.jobs.submit).toHaveBeenCalledWith(
					'data-export',
					{ format: 'json' },
					expect.objectContaining({ namespace: 'wayli' })
				);
				expect(result).toEqual(newJob);
			});

			it('should throw error when type is missing', async () => {
				await expect(adapter.createJob({ data: {} })).rejects.toThrow('Job type is required');
			});
		});

		describe('getJobProgress', () => {
			it('should return job progress information', async () => {
				const job = {
					id: 'job-id',
					status: 'running',
					progress_percent: 50,
					progress_message: 'Processing...'
				};
				mockFluxbase.jobs.get.mockResolvedValue({ data: job, error: null });

				const result = await adapter.getJobProgress('job-id');

				expect(result.progress).toBe(50);
				expect(result.status).toBe('running');
			});

			it('should throw error when job not found', async () => {
				mockFluxbase.jobs.get.mockResolvedValue({
					data: null,
					error: { message: 'Not found' }
				});

				await expect(adapter.getJobProgress('invalid')).rejects.toThrow('Job not found');
			});
		});

		describe('cancelJob', () => {
			it('should cancel a job', async () => {
				mockFluxbase.jobs.get.mockResolvedValue({
					data: { id: 'job-id', job_name: 'data-export' },
					error: null
				});
				mockFluxbase.jobs.cancel.mockResolvedValue({ error: null });

				const result = await adapter.cancelJob('job-id');

				expect(mockFluxbase.jobs.cancel).toHaveBeenCalledWith('job-id');
				expect(result.jobId).toBe('job-id');
			});

			it('should auto-create reverse geocoding job when import is cancelled', async () => {
				mockFluxbase.jobs.get.mockResolvedValue({
					data: { id: 'job-id', job_name: 'data_import' },
					error: null
				});
				mockFluxbase.jobs.cancel.mockResolvedValue({ error: null });
				mockFluxbase.jobs.submit.mockResolvedValue({ data: {}, error: null });

				await adapter.cancelJob('job-id');

				expect(mockFluxbase.jobs.submit).toHaveBeenCalledWith(
					'reverse_geocoding',
					expect.objectContaining({
						auto_created: true,
						triggered_by: 'import_cancellation'
					}),
					expect.any(Object)
				);
			});
		});
	});

	describe('Export Operations', () => {
		describe('getExportJobs', () => {
			it('should fetch and combine export jobs from all statuses', async () => {
				mockFluxbase.jobs.list
					.mockResolvedValueOnce({
						data: [{ id: '1', job_name: 'data-export', created_at: '2024-01-03' }],
						error: null
					})
					.mockResolvedValueOnce({
						data: [{ id: '2', job_name: 'data-export', created_at: '2024-01-02' }],
						error: null
					})
					.mockResolvedValueOnce({
						data: [{ id: '3', job_name: 'data-import', created_at: '2024-01-01' }],
						error: null
					})
					.mockResolvedValueOnce({ data: [], error: null });

				const result = await adapter.getExportJobs();

				// Should only include data-export jobs
				expect(result).toHaveLength(2);
				expect(result[0].id).toBe('1'); // Most recent first
			});
		});

		describe('createExportJob', () => {
			it('should create an export job', async () => {
				mockFluxbase.jobs.submit.mockResolvedValue({
					data: { id: 'export-job-id' },
					error: null
				});

				await adapter.createExportJob({ format: 'json' });

				expect(mockFluxbase.jobs.submit).toHaveBeenCalledWith(
					'data-export',
					expect.objectContaining({ format: 'json' }),
					expect.any(Object)
				);
			});
		});

		describe('getExportDownloadUrl', () => {
			it('should return download URL for completed export', async () => {
				mockFluxbase.jobs.get.mockResolvedValue({
					data: {
						id: 'job-id',
						job_name: 'data-export',
						status: 'completed',
						created_by: 'test-user-id',
						result: { file_path: 'exports/file.json' }
					},
					error: null
				});

				const storageMock = {
					getPublicUrl: vi.fn().mockReturnValue({
						data: { publicUrl: 'https://storage.example.com/exports/file.json' }
					})
				};
				mockFluxbase.storage.from.mockReturnValue(storageMock);

				const result = await adapter.getExportDownloadUrl('job-id');

				expect(result.downloadUrl).toBe('https://storage.example.com/exports/file.json');
			});

			it('should throw error when export not ready', async () => {
				mockFluxbase.jobs.get.mockResolvedValue({
					data: {
						id: 'job-id',
						job_name: 'data-export',
						status: 'running',
						created_by: 'test-user-id'
					},
					error: null
				});

				await expect(adapter.getExportDownloadUrl('job-id')).rejects.toThrow(
					'Export file not ready'
				);
			});

			it('should throw error when job belongs to different user', async () => {
				mockFluxbase.jobs.get.mockResolvedValue({
					data: {
						id: 'job-id',
						job_name: 'data-export',
						status: 'completed',
						created_by: 'other-user-id'
					},
					error: null
				});

				await expect(adapter.getExportDownloadUrl('job-id')).rejects.toThrow(
					'Export job not found'
				);
			});
		});
	});

	describe('Geocoding Operations', () => {
		describe('searchGeocode', () => {
			beforeEach(() => {
				global.fetch = vi.fn();
			});

			it('should search Pelias API and transform results', async () => {
				const peliasResponse = {
					features: [
						{
							geometry: { coordinates: [2.3522, 48.8566] },
							properties: {
								label: 'Paris, France',
								name: 'Paris',
								layer: 'locality',
								locality: 'Paris',
								country: 'France',
								country_a: 'FR'
							}
						}
					]
				};

				(global.fetch as any).mockResolvedValue({
					ok: true,
					json: () => Promise.resolve(peliasResponse)
				});

				const result = await adapter.searchGeocode('Paris');

				expect(result).toHaveLength(1);
				expect(result[0].display_name).toBe('Paris, France');
				expect(result[0].lat).toBe(48.8566);
				expect(result[0].lon).toBe(2.3522);
			});

			it('should throw error when geocoding fails', async () => {
				(global.fetch as any).mockResolvedValue({
					ok: false,
					status: 500
				});

				await expect(adapter.searchGeocode('Invalid')).rejects.toThrow('Geocoding search failed');
			});

			it('should return empty array when no features', async () => {
				(global.fetch as any).mockResolvedValue({
					ok: true,
					json: () => Promise.resolve({ features: [] })
				});

				const result = await adapter.searchGeocode('Nonexistent');

				expect(result).toEqual([]);
			});
		});
	});

	describe('Admin Operations', () => {
		beforeEach(() => {
			// Mock admin user
			const adminQuery = createQueryMock({ role: 'admin' });
			mockFluxbase.from.mockReturnValue(adminQuery);
		});

		describe('getAllSettings', () => {
			it('should fetch and combine all settings', async () => {
				mockFluxbase.admin.settings.app.get.mockResolvedValue({
					signup_enabled: true
				});
				mockFluxbase.admin.settings.app.listSettings.mockResolvedValue([
					{ key: 'wayli.feature', value: true }
				]);
				mockFluxbase.admin.ai.listProviders.mockResolvedValue({
					data: [{ id: '1', name: 'openai', enabled: true }]
				});
				mockFluxbase.admin.settings.system.get.mockResolvedValue({
					value: { value: true }
				});
				mockFluxbase.admin.settings.email.get.mockResolvedValue({
					smtp_host: 'smtp.example.com'
				});

				const result = await adapter.getAllSettings();

				expect(result.app).toBeDefined();
				expect(result.custom).toBeDefined();
			});
		});

		describe('updateAppSetting', () => {
			it('should call correct method for enableSignup action', async () => {
				mockFluxbase.admin.settings.app.enableSignup.mockResolvedValue({});

				await adapter.updateAppSetting('enableSignup');

				expect(mockFluxbase.admin.settings.app.enableSignup).toHaveBeenCalled();
			});

			it('should call correct method for disableSignup action', async () => {
				mockFluxbase.admin.settings.app.disableSignup.mockResolvedValue({});

				await adapter.updateAppSetting('disableSignup');

				expect(mockFluxbase.admin.settings.app.disableSignup).toHaveBeenCalled();
			});

			it('should update email settings', async () => {
				mockFluxbase.admin.settings.email.update.mockResolvedValue({});

				await adapter.updateAppSetting('updateEmailSettings', { smtp_host: 'new.smtp.com' });

				expect(mockFluxbase.admin.settings.email.update).toHaveBeenCalledWith({
					smtp_host: 'new.smtp.com'
				});
			});

			it('should throw error for unknown action', async () => {
				await expect(adapter.updateAppSetting('unknownAction')).rejects.toThrow(
					'Unknown action: unknownAction'
				);
			});
		});

		describe('getAdminUsers', () => {
			it('should fetch paginated users', async () => {
				const profileQuery = createQueryMock({ role: 'admin' });
				const usersQuery = createQueryMock([{ id: 'user1', email: 'user1@example.com' }]);
				const countQuery = createQueryMock();
				countQuery.then = vi.fn((resolve: any) => resolve({ count: 100 }));

				mockFluxbase.from
					.mockReturnValueOnce(profileQuery) // Check admin
					.mockReturnValueOnce(usersQuery) // Get users
					.mockReturnValueOnce(countQuery); // Get count

				const result = await adapter.getAdminUsers({ page: 1, limit: 50 });

				expect(result.users).toBeDefined();
				expect(result.page).toBe(1);
				expect(result.limit).toBe(50);
			});

			it('should throw error for non-admin user', async () => {
				const nonAdminQuery = createQueryMock({ role: 'user' });
				mockFluxbase.from.mockReturnValue(nonAdminQuery);

				await expect(adapter.getAdminUsers()).rejects.toThrow(
					'Unauthorized: Admin access required'
				);
			});
		});
	});

	describe('Trip Exclusions', () => {
		describe('getTripExclusions', () => {
			it('should fetch user trip exclusions', async () => {
				const queryMock = createQueryMock({
					trip_exclusions: [{ id: 'ex1', name: 'Home', location: { lat: 0, lon: 0 } }]
				});
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getTripExclusions();

				expect(result.exclusions).toHaveLength(1);
				expect(result.exclusions[0].name).toBe('Home');
			});

			it('should return empty array when no preferences', async () => {
				const queryMock = createQueryMock(null, { message: 'Not found' });
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getTripExclusions();

				expect(result.exclusions).toEqual([]);
			});
		});

		describe('createTripExclusion', () => {
			it('should add new exclusion to preferences', async () => {
				const getMock = createQueryMock({ trip_exclusions: [] });
				const upsertMock = createQueryMock();
				upsertMock.then = vi.fn((resolve: any) => resolve({ error: null }));

				mockFluxbase.from.mockReturnValueOnce(getMock).mockReturnValueOnce(upsertMock);

				const result = await adapter.createTripExclusion({
					name: 'Office',
					location: { lat: 1, lon: 1 }
				});

				expect(result.exclusion.name).toBe('Office');
				expect(result.exclusion.id).toBeDefined();
			});

			it('should throw error when name is missing', async () => {
				await expect(adapter.createTripExclusion({ location: { lat: 0, lon: 0 } })).rejects.toThrow(
					'Name and location are required'
				);
			});
		});

		describe('deleteTripExclusion', () => {
			it('should remove exclusion from preferences', async () => {
				const getMock = createQueryMock({
					trip_exclusions: [{ id: 'ex1', name: 'Home' }]
				});
				const upsertMock = createQueryMock();
				upsertMock.then = vi.fn((resolve: any) => resolve({ error: null }));

				mockFluxbase.from.mockReturnValueOnce(getMock).mockReturnValueOnce(upsertMock);

				const result = await adapter.deleteTripExclusion('ex1');

				expect(result.message).toBe('Exclusion deleted successfully');
			});
		});
	});

	describe('System Secrets', () => {
		describe('setSystemSecret', () => {
			it('should set encrypted secret', async () => {
				mockFluxbase.admin.settings.app.setSecretSetting.mockResolvedValue({});

				const result = await adapter.setSystemSecret('api_key', 'secret-value', 'API Key');

				expect(mockFluxbase.admin.settings.app.setSecretSetting).toHaveBeenCalledWith(
					'api_key',
					'secret-value',
					{ description: 'API Key' }
				);
				expect(result.updated).toBe('api_key');
			});
		});

		describe('getSystemSecretMetadata', () => {
			it('should return metadata without value', async () => {
				mockFluxbase.admin.settings.app.getSecretSetting.mockResolvedValue({
					key: 'api_key',
					created_at: '2024-01-01'
				});

				const result = await adapter.getSystemSecretMetadata('api_key');

				expect(result.key).toBe('api_key');
			});

			it('should return null when secret not found', async () => {
				mockFluxbase.admin.settings.app.getSecretSetting.mockRejectedValue(new Error('Not found'));

				const result = await adapter.getSystemSecretMetadata('nonexistent');

				expect(result).toBeNull();
			});
		});

		describe('listSystemSecrets', () => {
			it('should list all secrets metadata', async () => {
				mockFluxbase.admin.settings.app.listSecretSettings.mockResolvedValue([
					{ key: 'secret1' },
					{ key: 'secret2' }
				]);

				const result = await adapter.listSystemSecrets();

				expect(result).toHaveLength(2);
			});
		});

		describe('deleteSystemSecret', () => {
			it('should delete a secret', async () => {
				mockFluxbase.admin.settings.app.deleteSecretSetting.mockResolvedValue({});

				const result = await adapter.deleteSystemSecret('api_key');

				expect(mockFluxbase.admin.settings.app.deleteSecretSetting).toHaveBeenCalledWith('api_key');
				expect(result.deleted).toBe('api_key');
			});
		});
	});

	describe('POI Visits', () => {
		describe('getPOIVisits', () => {
			it('should fetch POI visits for user', async () => {
				const visits = [{ id: 'visit1', visited_at: '2024-01-01', poi_name: 'Restaurant' }];
				const queryMock = createQueryMock(visits);
				mockFluxbase.from.mockReturnValue(queryMock);

				const result = await adapter.getPOIVisits();

				expect(mockFluxbase.from).toHaveBeenCalledWith('poi_visits');
				expect(result).toEqual(visits);
			});
		});

		describe('detectPOIVisits', () => {
			it('should create POI detection job', async () => {
				mockFluxbase.jobs.submit.mockResolvedValue({
					data: { id: 'job-id' },
					error: null
				});

				await adapter.detectPOIVisits({
					startDate: '2024-01-01',
					endDate: '2024-01-31'
				});

				expect(mockFluxbase.jobs.submit).toHaveBeenCalledWith(
					'poi_detection',
					expect.objectContaining({
						start_date: '2024-01-01',
						end_date: '2024-01-31'
					}),
					expect.any(Object)
				);
			});
		});
	});

	describe('AI Features', () => {
		describe('isAIEnabled', () => {
			it('should return true when AI is enabled and providers configured', async () => {
				mockFluxbase.admin.settings.app.getSetting.mockResolvedValue(true);
				mockFluxbase.admin.ai.listProviders.mockResolvedValue({
					data: [{ id: '1', enabled: true }]
				});

				const result = await adapter.isAIEnabled();

				expect(result).toBe(true);
			});

			it('should return false when AI is disabled', async () => {
				mockFluxbase.admin.settings.app.getSetting.mockResolvedValue(false);

				const result = await adapter.isAIEnabled();

				expect(result).toBe(false);
			});

			it('should return false when no providers configured', async () => {
				mockFluxbase.admin.settings.app.getSetting.mockResolvedValue(true);
				mockFluxbase.admin.ai.listProviders.mockResolvedValue({ data: [] });

				const result = await adapter.isAIEnabled();

				expect(result).toBe(false);
			});

			it('should return false on error', async () => {
				mockFluxbase.admin.settings.app.getSetting.mockRejectedValue(new Error('Error'));

				const result = await adapter.isAIEnabled();

				expect(result).toBe(false);
			});
		});

		describe('updateAIConfig', () => {
			it('should update AI enabled setting', async () => {
				mockFluxbase.admin.settings.app.setSetting.mockResolvedValue({});

				await adapter.updateAIConfig({ enabled: true });

				expect(mockFluxbase.admin.settings.app.setSetting).toHaveBeenCalledWith(
					'app.ai.enabled',
					true,
					expect.any(Object)
				);
			});

			it('should create new provider when not existing', async () => {
				mockFluxbase.admin.settings.app.setSetting.mockResolvedValue({});
				mockFluxbase.admin.ai.listProviders.mockResolvedValue({ data: [] });
				mockFluxbase.admin.ai.createProvider.mockResolvedValue({});

				await adapter.updateAIConfig({
					enabled: true,
					provider: {
						name: 'openai',
						display_name: 'OpenAI',
						provider_type: 'openai',
						config: { api_key: 'key' }
					}
				});

				expect(mockFluxbase.admin.ai.createProvider).toHaveBeenCalled();
			});

			it('should update existing provider', async () => {
				mockFluxbase.admin.settings.app.setSetting.mockResolvedValue({});
				mockFluxbase.admin.ai.listProviders.mockResolvedValue({
					data: [{ id: 'provider-1', name: 'openai' }]
				});
				mockFluxbase.admin.ai.updateProvider.mockResolvedValue({});

				await adapter.updateAIConfig({
					enabled: true,
					provider: {
						name: 'openai',
						display_name: 'OpenAI Updated',
						provider_type: 'openai',
						config: { api_key: 'new-key' }
					}
				});

				expect(mockFluxbase.admin.ai.updateProvider).toHaveBeenCalledWith(
					'provider-1',
					expect.any(Object)
				);
			});
		});
	});

	describe('Import Operations', () => {
		describe('createImportJob', () => {
			// Helper to create a mock File with arrayBuffer support
			function createMockFile(content: string, name: string, type: string) {
				const encoder = new TextEncoder();
				const buffer = encoder.encode(content).buffer;
				const file = {
					name,
					type,
					size: content.length,
					arrayBuffer: vi.fn().mockResolvedValue(buffer)
				} as unknown as File;
				return file;
			}

			it('should upload file and create import job', async () => {
				const file = createMockFile('test content', 'test.gpx', 'application/gpx+xml');

				const storageMock = {
					upload: vi.fn().mockResolvedValue({ data: {}, error: null })
				};
				mockFluxbase.storage.from.mockReturnValue(storageMock);

				mockFluxbase.functions.invoke.mockResolvedValue({
					data: {
						success: true,
						data: {
							success: true,
							data: { jobId: 'import-job-id' }
						}
					},
					error: null
				});

				const result = await adapter.createImportJob(file, 'gpx');

				expect(storageMock.upload).toHaveBeenCalled();
				expect(mockFluxbase.functions.invoke).toHaveBeenCalledWith(
					'import',
					expect.objectContaining({
						body: expect.objectContaining({
							format: 'gpx',
							file_name: 'test.gpx'
						})
					})
				);
				expect(result.jobId).toBe('import-job-id');
			});

			it('should throw error when upload fails', async () => {
				const file = createMockFile('test', 'test.gpx', 'application/gpx+xml');

				const storageMock = {
					upload: vi.fn().mockResolvedValue({
						data: null,
						error: { message: 'Upload failed' }
					})
				};
				mockFluxbase.storage.from.mockReturnValue(storageMock);

				await expect(adapter.createImportJob(file, 'gpx')).rejects.toThrow('File upload failed');
			});
		});
	});
});
