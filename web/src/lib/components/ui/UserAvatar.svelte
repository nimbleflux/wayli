<script lang="ts">
	interface UserData {
		first_name?: string;
		last_name?: string;
		full_name?: string;
		email?: string;
		avatar_url?: string;
	}

	interface Props {
		user?: UserData | null;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		showFallback?: boolean;
	}

	let { user = null, size = 'md', showFallback = $bindable(true) }: Props = $props();

	// Generate initials from user data
	let initials = $derived(getInitials(user));

	// Size classes
	const sizeClasses = {
		sm: 'h-8 w-8 text-sm',
		md: 'h-10 w-10 text-base',
		lg: 'h-12 w-12 text-lg',
		xl: 'h-16 w-16 text-xl'
	};

	function getInitials(user: UserData | null): string {
		if (!user) return '?';

		// Try to get initials from first and last name
		if (user.first_name && user.last_name) {
			return `${user.first_name.charAt(0).toUpperCase()}${user.last_name.charAt(0).toUpperCase()}`;
		}

		// Try to get initials from full name
		if (user.full_name) {
			const nameParts = user.full_name.trim().split(/\s+/);
			if (nameParts.length >= 2) {
				return `${nameParts[0].charAt(0).toUpperCase()}${nameParts[nameParts.length - 1].charAt(0).toUpperCase()}`;
			}
			return nameParts[0].charAt(0).toUpperCase();
		}

		// Fallback to email
		if (user.email) {
			return user.email.charAt(0).toUpperCase();
		}

		return '?';
	}
</script>

{#if user?.avatar_url && showFallback}
	<!-- Use custom avatar URL if provided -->
	<img
		src={user.avatar_url}
		alt="User avatar"
		class="rounded-full object-cover {sizeClasses[size]}"
		onerror={() => (showFallback = false)}
	/>
{:else}
	<!-- Generate initials avatar -->
	<div
		class="flex items-center justify-center rounded-full bg-red-500 font-semibold text-white {sizeClasses[
			size
		]}"
		title={user?.full_name || user?.email || 'User'}
	>
		{initials}
	</div>
{/if}
