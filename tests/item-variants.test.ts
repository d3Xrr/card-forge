import assert from 'node:assert/strict';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import {
	discoverItemVariants,
	inferVariantBaseName,
} from '../src/services/item-variants';
import { applyCardOverrides } from '../src/services/card-overrides';

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
