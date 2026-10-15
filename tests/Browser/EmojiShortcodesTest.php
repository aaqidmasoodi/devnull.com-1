<?php

declare(strict_types=1);

use App\Models\Commit;
use App\Models\User;

it('renders emoji shortcodes as emoji', function (): void {
    $viewer = User::factory()->create();

    $commit = Commit::factory()->create([
        'body' => 'This commit body is intentionally long enough to clear the sixty character title cut-off before :heart :like',
    ]);

    $this->actingAs($viewer);

    visit(route('commit.show', [$commit->user, $commit]))
        ->assertSee('❤️')
        ->assertSee('👍')
        ->assertDontSee(':heart')
        ->assertDontSee(':like')
        ->assertNoJavaScriptErrors();
});

it('leaves shortcode prefixes inside longer words untouched', function (): void {
    $viewer = User::factory()->create();

    $commit = Commit::factory()->create([
        'body' => 'This commit body is intentionally long enough to clear the sixty character title cut-off before :heartbeat :likewise',
    ]);

    $this->actingAs($viewer);

    visit(route('commit.show', [$commit->user, $commit]))
        ->assertSee(':heartbeat')
        ->assertSee(':likewise')
        ->assertDontSee('❤️')
        ->assertDontSee('👍')
        ->assertNoJavaScriptErrors();
});
