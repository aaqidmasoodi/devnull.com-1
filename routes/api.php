<?php

declare(strict_types=1);

use App\Http\Controllers\CliCommitController;
use App\Http\Controllers\CliKeyLookupController;
use App\Http\Middleware\AuthenticateSshSignature;
use Illuminate\Support\Facades\Route;

Route::prefix('cli')->group(function (): void {
    Route::post('commits', [CliCommitController::class, 'store'])
        ->middleware([AuthenticateSshSignature::class, 'throttle:commits'])
        ->name('cli-commit.store');
    Route::post('key-lookups', [CliKeyLookupController::class, 'store'])
        ->middleware('throttle:60,1')
        ->name('cli-key-lookup.store');
});
