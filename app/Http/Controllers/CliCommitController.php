<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Actions\CreateCommit;
use App\Enums\CommitStatus;
use App\Http\Requests\CreateCommitRequest;
use App\Models\User;
use Illuminate\Container\Attributes\CurrentUser;
use Illuminate\Http\Response;

final readonly class CliCommitController
{
    public function store(CreateCommitRequest $request, #[CurrentUser] User $user, CreateCommit $action): Response
    {
        $commit = $action->handle($user, $request->string('body')->value());

        $url = route('commit.show', [$user, $commit]);

        $message = $commit->status === CommitStatus::Pending
            ? __('Committed: :url (pending review, only you can see it until it is approved)', ['url' => $url])
            : __('Committed: :url', ['url' => $url]);

        return response($message."\n", 201)->header('Content-Type', 'text/plain; charset=utf-8');
    }
}
