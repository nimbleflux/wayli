# Wayli UI Components

This document provides an overview of the reusable UI components available in the Wayli application.

## Component Structure

Components are organized in the following directories:

```
src/lib/components/
├── ui/                    # Core reusable UI components
│   ├── accessible-button/ # Accessible button with loading states
│   ├── accessible-input/  # Accessible form input
│   ├── accessible-modal/  # Accessible modal dialog
│   ├── alert-dialog/      # Confirmation dialogs
│   ├── badge/             # Status badges
│   ├── button/            # Basic button component
│   ├── card/              # Card container
│   ├── icon/              # Icon wrapper
│   ├── input/             # Form input
│   ├── modal/             # Modal dialog
│   ├── popover/           # Popover menus
│   ├── responsive-grid/   # Responsive grid layout
│   ├── toaster/           # Toast notifications
│   └── tooltip/           # Tooltips
├── modals/                # Application-specific modals
│   ├── ConfirmationModal.svelte
│   ├── EditExclusionModal.svelte
│   └── TripModal.svelte
├── forms/                 # Form components
├── trips/                 # Trip-related components
├── dashboard/             # Dashboard components
└── map/                   # Map components
```

## Core UI Components

### AccessibleButton

A button component with built-in accessibility features, loading states, and variant styling.

```svelte
<script>
  import AccessibleButton from '$lib/components/ui/accessible-button/index.svelte';
</script>

<!-- Primary button -->
<AccessibleButton onClick={handleClick}>
  Click me
</AccessibleButton>

<!-- Loading state -->
<AccessibleButton onClick={handleSubmit} loading={isLoading}>
  Submit
</AccessibleButton>

<!-- Variant -->
<AccessibleButton variant="outline" onClick={handleCancel}>
  Cancel
</AccessibleButton>

<!-- Danger variant -->
<AccessibleButton variant="danger" onClick={handleDelete}>
  Delete
</AccessibleButton>
```

**Props:**
- `onClick` - Click handler function
- `loading` - Show loading spinner (default: false)
- `disabled` - Disable the button (default: false)
- `variant` - Visual variant: 'primary' | 'outline' | 'danger'
- `class` - Additional CSS classes

### AccessibleInput

Form input with accessibility features and validation support.

```svelte
<script>
  import AccessibleInput from '$lib/components/ui/accessible-input/index.svelte';
  let email = '';
</script>

<AccessibleInput
  bind:value={email}
  label="Email"
  type="email"
  placeholder="you@example.com"
  required
/>
```

**Props:**
- `value` - Input value (bindable)
- `label` - Label text
- `type` - Input type (text, email, password, etc.)
- `placeholder` - Placeholder text
- `required` - Make field required
- `error` - Error message to display
- `disabled` - Disable the input

### Modal

A flexible modal dialog component.

```svelte
<script>
  import Modal from '$lib/components/ui/modal/index.svelte';
  let isOpen = false;
</script>

<Modal
  open={isOpen}
  title="Confirm Action"
  size="md"
  onClose={() => isOpen = false}
>
  <p>Are you sure you want to proceed?</p>

  <svelte:fragment slot="footer">
    <button onclick={() => isOpen = false}>Cancel</button>
    <button onclick={handleConfirm}>Confirm</button>
  </svelte:fragment>
</Modal>
```

**Props:**
- `open` - Whether modal is open
- `title` - Modal title
- `size` - 'sm' | 'md' | 'lg' | 'xl'
- `showCloseButton` - Show X button (default: true)
- `onClose` - Close callback

### ConfirmationModal

A specialized modal for confirmation dialogs with variants.

```svelte
<script>
  import ConfirmationModal from '$lib/components/modals/ConfirmationModal.svelte';
</script>

<ConfirmationModal
  open={showConfirm}
  title="Delete Trip"
  message="Are you sure you want to delete this trip?"
  variant="danger"
  confirmText="Delete"
  onConfirm={handleDelete}
  onCancel={() => showConfirm = false}
/>
```

**Props:**
- `open` - Whether modal is open
- `title` - Modal title
- `message` - Confirmation message
- `variant` - 'danger' | 'warning' | 'info'
- `confirmText` - Text for confirm button
- `cancelText` - Text for cancel button
- `icon` - Custom icon component
- `onConfirm` - Confirm callback
- `onCancel` - Cancel callback

### Badge

Status indicator badges.

```svelte
<script>
  import Badge from '$lib/components/ui/badge/index.svelte';
</script>

<Badge variant="success">Completed</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Failed</Badge>
<Badge variant="info">Processing</Badge>
```

### Card

Container component with consistent styling.

```svelte
<script>
  import Card from '$lib/components/ui/card/index.svelte';
</script>

<Card>
  <h3>Card Title</h3>
  <p>Card content goes here.</p>
</Card>
```

### Tooltip

Hover tooltip for additional information.

```svelte
<script>
  import Tooltip from '$lib/components/ui/tooltip/index.svelte';
</script>

<Tooltip content="This is helpful information">
  <button>Hover me</button>
</Tooltip>
```

### DateRangePicker

Date range selection component.

```svelte
<script>
  import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
  let startDate = new Date();
  let endDate = new Date();
</script>

<DateRangePicker
  bind:startDate
  bind:endDate
  onChange={handleDateChange}
/>
```

### AddressSearch

Location autocomplete component using Pelias geocoding.

```svelte
<script>
  import AddressSearch from '$lib/components/ui/address-search/index.svelte';
</script>

<AddressSearch
  onSelect={(result) => {
    console.log(result.lat, result.lon);
  }}
  placeholder="Search for a location..."
/>
```

### UserAvatar

User avatar component with fallback initials.

```svelte
<script>
  import UserAvatar from '$lib/components/ui/UserAvatar.svelte';
</script>

<UserAvatar user={currentUser} size="md" />
<UserAvatar user={currentUser} size="lg" />
```

**Props:**
- `user` - User object with name/email
- `size` - 'sm' | 'md' | 'lg' | 'xl'
- `showFallback` - Show initials when no avatar

## Application Components

### TripCard

Displays trip information in a card format.

```svelte
<script>
  import TripCard from '$lib/components/TripCard.svelte';
</script>

<TripCard
  title="Paris Trip"
  labels={['vacation', 'family']}
  distance="1,234 km"
  duration="5 days"
  image="/images/paris.jpg"
  countries={['FR', 'BE']}
  onDelete={handleDelete}
/>
```

## Styling Guidelines

### Tailwind CSS

All components use Tailwind CSS for styling. Key classes:

- **Colors**: Use `bg-primary`, `text-primary` for brand colors
- **Dark mode**: Use `dark:` prefix for dark mode styles
- **Responsive**: Use `sm:`, `md:`, `lg:` for responsive designs

### CSS Variables

The application uses CSS custom properties for theming:

```css
:root {
  --color-primary: ...;
  --color-background: ...;
  --color-foreground: ...;
}
```

## Accessibility Guidelines

1. **Labels**: All interactive elements must have accessible labels
2. **Focus states**: Visible focus indicators for keyboard navigation
3. **ARIA**: Use appropriate ARIA attributes for complex widgets
4. **Color contrast**: Maintain WCAG 2.1 AA contrast ratios
5. **Motion**: Respect `prefers-reduced-motion` for animations

## Usage with Svelte 5

Components use Svelte 5 runes:

```svelte
<script lang="ts">
  interface Props {
    title: string;
    onClick?: () => void;
  }

  let { title, onClick }: Props = $props();

  let count = $state(0);
  let doubled = $derived(count * 2);
</script>
```

## Testing Components

Components have corresponding tests in `tests/components/`:

```bash
# Run component tests
npm run test

# Run with coverage
npm run test:coverage
```
