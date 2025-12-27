// Type declarations for GeoJSON imports
declare module '*.geojson' {
	const value: import('geojson').FeatureCollection;
	export default value;
}
