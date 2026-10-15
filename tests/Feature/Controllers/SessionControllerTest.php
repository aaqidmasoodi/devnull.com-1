<?php

declare(strict_types=1);

use App\Enums\Log;
use App\Models\User;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Http;
use Laravel\Socialite\Socialite;
use Laravel\Socialite\Two\InvalidStateException;
use Laravel\Socialite\Two\User as GitHubUser;
use Tests\Support\SshKeyPair;

it('redirects to github', function (): void {
    Socialite::fake('github');

    $response = $this->get(route('login'));

    $response->assertRedirect();
});

it('creates a user and logs them in', function (): void {
    Http::fake(['api.github.com/*' => Http::response(status: 404)]);

    Socialite::fake('github', GitHubUser::fake([
        'id' => '583231',
        'nickname' => 'octocat',
        'name' => 'The Octocat',
        'email' => 'octocat@github.com',
        'avatar' => 'https://avatars.githubusercontent.com/u/583231',
        'bio' => 'I am the Octocat.',
        'location' => 'San Francisco',
        'blog' => 'https://github.blog',
        'company' => '@github',
    ]));

    $response = $this->get(route('login.store'));

    $response->assertRedirectToRoute('log.show', Log::Following);

    $user = User::query()->where('github_id', '583231')->sole();

    expect($user)
        ->username->toBe('octocat')
        ->name->toBe('The Octocat')
        ->email->toBe('octocat@github.com')
        ->avatar_url->toBe('https://avatars.githubusercontent.com/u/583231')
        ->bio->toBe('I am the Octocat.')
        ->location->toBe('San Francisco')
        ->website->toBe('https://github.blog')
        ->company->toBe('@github');

    $this->assertAuthenticatedAs($user);
});

it('updates an existing user on login', function (): void {
    Http::fake(['api.github.com/*' => Http::response(status: 404)]);

    $user = User::factory()->create([
        'github_id' => '583231',
        'username' => 'old-username',
    ]);

    Socialite::fake('github', GitHubUser::fake([
        'id' => '583231',
        'nickname' => 'octocat',
    ]));

    $response = $this->get(route('login.store'));

    $response->assertRedirectToRoute('log.show', Log::Following);

    expect(User::query()->count())->toBeOne()
        ->and($user->refresh()->username)->toBe('octocat');

    $this->assertAuthenticatedAs($user);
});

it('syncs the ssh keys of the user on login', function (): void {
    $publicKey = SshKeyPair::generate()->publicKey;

    Http::fake([
        'api.github.com/user/583231' => Http::response(['login' => 'octocat']),
        'api.github.com/users/octocat/keys*' => Http::response([['id' => 1, 'key' => $publicKey->toOpenSsh()]]),
        'api.github.com/users/octocat/ssh_signing_keys*' => Http::response([]),
    ]);

    Socialite::fake('github', GitHubUser::fake([
        'id' => '583231',
        'nickname' => 'octocat',
    ]));

    $this->withoutDefer()->get(route('login.store'));

    $user = User::query()->where('github_id', '583231')->sole();

    expect($user->sshKeys()->sole()->fingerprint)->toBe($publicKey->fingerprint());
});

it('logs in even when the ssh keys cannot be synced', function (): void {
    Exceptions::fake();

    Http::fake([
        'api.github.com/*' => Http::response(['message' => 'Server Error'], 500),
    ]);

    Socialite::fake('github', GitHubUser::fake([
        'id' => '583231',
        'nickname' => 'octocat',
    ]));

    $response = $this->withoutDefer()->get(route('login.store'));

    $response->assertRedirectToRoute('log.show', Log::Following);

    $this->assertAuthenticated();

    Exceptions::assertReported(RequestException::class);
});

it('redirects to the intended url after login', function (): void {
    Http::fake(['api.github.com/*' => Http::response(status: 404)]);

    $user = User::factory()->create();

    Socialite::fake('github', GitHubUser::fake([
        'id' => '583231',
    ]));

    $this->get(route('user.show', $user))
        ->assertRedirectToRoute('home');

    $response = $this->get(route('login.store'));

    $response->assertRedirectToRoute('user.show', $user);
});

it('fails when the user denies access', function (): void {
    $response = $this->get(route('login.store', ['error' => 'access_denied']));

    $response->assertRedirectToRoute('home')
        ->assertInertiaFlash('toast', [
            'type' => 'error',
            'message' => __('Unable to sign in with GitHub. Please try again.'),
        ]);

    $this->assertGuest();
});

it('fails when the state is invalid', function (): void {
    Socialite::shouldReceive('driver->user')->andThrow(new InvalidStateException);

    $response = $this->get(route('login.store'));

    $response->assertRedirectToRoute('home')
        ->assertInertiaFlash('toast', [
            'type' => 'error',
            'message' => __('Unable to sign in with GitHub. Please try again.'),
        ]);

    $this->assertGuest();
});

it('redirects authenticated users away from login', function (): void {
    $user = User::factory()->create();

    $response = $this->actingAs($user)
        ->get(route('login'));

    $response->assertRedirectToRoute('log.show', Log::Following);
});

it('may destroy a session', function (): void {
    $user = User::factory()->create();

    $response = $this->actingAs($user)
        ->fromRoute('log.show', Log::Following)
        ->post(route('logout'));

    $response->assertRedirectToRoute('home');

    $this->assertGuest();
});
