import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	discoverItemVariants,
	getVariantDisplayLabel,
	inferVariantBaseName,
} from '../src/services/item-variants';
import { applyCardOverrides } from '../src/services/card-overrides';
import { buildItemStatRows } from '../src/renderer/structured-item-stats';

function item(name: string, description = ''): ItemCardData {
	return { filePath: `items/${name}.md`, name, description, hasImage: false, rawTags: [] };
}

void test('discovers bonus-prefixed armor variants and merges base statistics', () => {
	const base = { ...item('Breastplate'), detail: 'Medium armor', cost: '400 gp', weight: 20 };
	const source = {
		...item('+1 Armor', [
			'While wearing this armor, you gain a magical benefit.',
			'',
			'**Variants**:',
			'- [[#^breastplate|+1 Breastplate]]',
			'',
			'### +1 Breastplate',
			'- **Armor Class**: 14 + Dex modifier (max 2)',
			'- **Weight**: 20 lb.',
		].join('\n')),
		rarity: 'rare',
	};
	const variants = discoverItemVariants(source, [source, base]);
	assert.equal(variants.length, 1);
	assert.equal(variants[0]?.baseName, 'Breastplate');
	assert.equal(variants[0]?.item.typeText, 'Medium armor');
	assert.equal(variants[0]?.item.cost, '400 gp');
	assert.equal(variants[0]?.item.weight, 20);
	assert.match(variants[0]?.item.description ?? '', /Armor Class/u);
	assert.doesNotMatch(variants[0]?.item.description ?? '', /\*\*Variants\*\*/u);
});

void test('discovers source-name-prefixed weapon variants with section stats', () => {
	const base = { ...item('Longsword'), detail: 'Weapon', mastery: 'Sap', cost: '15 gp' };
	const source = item('Flame Tongue', [
		'The weapon sheds bright light.',
		'',
		'**Variants**:',
		'- [[#longsword|Flame Tongue Longsword]]',
		'',
		'### Flame Tongue Longsword',
		'- **Damage**: 1d8 Slashing',
		'- **Two-Handed Damage**: 1d10 Slashing',
		'- **Properties**: [[Versatile]]',
	].join('\n'));
	const variant = discoverItemVariants(source, [source, base])[0];
	assert.equal(variant?.baseName, 'Longsword');
	assert.equal(variant?.item.damage, '1d8 Slashing');
	assert.equal(variant?.item.damageTwoHanded, '1d10 Slashing');
	assert.deepEqual(variant?.item.properties, ['Versatile']);
	assert.equal(variant?.item.mastery, 'Sap');
	assert.equal(variant?.item.cost, '15 gp');
	assert.doesNotMatch(variant?.item.description ?? '', /\*\*(?:Damage|Properties)\*\*/u);
	assert.ok(variant);
	assert.equal(
		applyCardOverrides(variant.item, { title: 'My Flame Blade' }).item.name,
		'My Flame Blade',
	);
});

void test('items without the marker and headings remain ordinary items', () => {
	assert.deepEqual(discoverItemVariants(item('Ordinary', 'Rules'), []), []);
	assert.equal(inferVariantBaseName('Flame Tongue', 'Unrelated Heading'), undefined);
});

void test('resolves a base item generically when a variant adds a trailing magic qualifier', () => {
	const base = { ...item('Breastplate'), weight: 20 };
	const source = item('+1 Armor of Cold Resistance', [
		'Magical resistance rule.',
		'**Variants**:',
		'### +1 Breastplate of Cold Resistance',
		'- **Weight**: 20 lb.',
	].join('\n'));
	const variant = discoverItemVariants(source, [source, base])[0];
	assert.equal(variant?.baseItem, base);
	assert.equal(variant?.baseName, 'Breastplate');
	assert.equal(variant?.item.name, '+1 Breastplate of Cold Resistance');
});

void test('projects plain nested one- and two-handed damage without duplicate stat prose', () => {
	const bases = [
		{ ...item('Dagger'), damage: '1d4 piercing', properties: ['Finesse', 'Light', 'Thrown'], mastery: 'Nick', range: '20/60', weight: 1, cost: '2 gp' },
		{ ...item('Longsword'), properties: ['Versatile'], mastery: 'Sap', weight: 3, cost: '15 gp' },
		{ ...item('Warhammer'), properties: ['Versatile'], mastery: 'Push', weight: 5, cost: '15 gp' },
		{ ...item('Spear'), properties: ['Thrown', 'Versatile'], mastery: 'Sap', range: '20/60', weight: 3, cost: '1 gp' },
	];
	const source = item('Flame Tongue', [
		'Magic flame rules remain visible.',
		'',
		'**Variants**:',
		'### Flame Tongue Dagger',
		'- **Damage**: 1d4 piercing',
		'- **Properties**: Finesse, Light, Thrown',
		'### Flame Tongue Longsword',
		'- **Damage**:',
		'  - One-handed: 1d8 slashing',
		'  - Two-handed: 1d10 slashing',
		'- **Properties**: [Versatile](/rules/versatile)',
		'### Flame Tongue Warhammer',
		'- **Damage**:',
		'  - One-handed: 1d8 bludgeoning',
		'  - Two-handed: 1d10 bludgeoning',
		'- **Properties**: Versatile',
		'### Flame Tongue Spear',
		'- **Damage**:',
		'  - One handed: 1d6 piercing',
		'  - Two handed: 1d8 piercing',
	].join('\n'));
	const variants = discoverItemVariants(source, [source, ...bases]);
	const byLabel = new Map(variants.map((variant) => [variant.label, variant]));

	const expected = [
		['Flame Tongue Dagger', '1d4 piercing', undefined],
		['Flame Tongue Longsword', '1d8 slashing', '1d10 slashing'],
		['Flame Tongue Warhammer', '1d8 bludgeoning', '1d10 bludgeoning'],
		['Flame Tongue Spear', '1d6 piercing', '1d8 piercing'],
	] as const;
	for (const [label, damage, twoHanded] of expected) {
		const variant = byLabel.get(label);
		assert.equal(variant?.item.damage, damage);
		assert.equal(variant?.item.damageTwoHanded, twoHanded);
		assert.match(variant?.item.description ?? '', /Magic flame rules remain visible/u);
		assert.doesNotMatch(
			variant?.item.description ?? '',
			/One[- ]handed|Two[- ]handed|\*\*Damage\*\*/iu,
		);
		const damageRow = variant
			? buildItemStatRows(variant.item).find((row) => row.label === 'Damage')
			: undefined;
		assert.ok(damageRow);
		assert.equal(damageRow.values.some((value) => value.includes(damage)), true);
		if (twoHanded) {
			assert.equal(damageRow.values.some((value) => value.includes(twoHanded)), true);
		}
	}
	assert.deepEqual(byLabel.get('Flame Tongue Longsword')?.item.properties, ['Versatile']);
});

void test('uses resolved base names only for concise selector presentation', () => {
	const base = item('Warhammer');
	const source = item('Flame Tongue', [
		'Rules',
		'**Variants**:',
		'### Flame Tongue Warhammer',
		'Variant rules.',
		'### Unresolved Ceremonial Form',
		'Fallback rules.',
	].join('\n'));
	const [resolved, fallback] = discoverItemVariants(source, [source, base]);
	assert.ok(resolved);
	assert.ok(fallback);
	assert.equal(getVariantDisplayLabel(resolved), 'Warhammer');
	assert.equal(resolved.label, 'Flame Tongue Warhammer');
	assert.equal(resolved.item.name, 'Flame Tongue Warhammer');
	assert.equal(getVariantDisplayLabel(fallback), 'Unresolved Ceremonial Form');
});

void test('selector labels fall back to headings when a base name is only inferred', () => {
	const source = item('+1 Armor', [
		'Rules',
		'**Variants**:',
		'### +1 Mythril Weave',
		'Variant rules.',
	].join('\n'));
	const variant = discoverItemVariants(source, [source])[0];
	assert.ok(variant);
	assert.equal(variant.baseName, 'Mythril Weave');
	assert.equal(variant.baseItem, undefined);
	assert.equal(getVariantDisplayLabel(variant), '+1 Mythril Weave');
});
