<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\Response;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

final readonly class CliScriptController
{
    /**
     * The `devnull commit` script: curl -fsSL https://devnull.laravel.cloud/commit | bash -s -- 'It was DNS.'
     */
    public function show(): Response
    {
        $script = Str::replace('__DEVNULL_URL__', url('/'), File::get(resource_path('scripts/commit.sh')));

        return response($script)->header('Content-Type', 'text/plain; charset=utf-8');
    }
}
