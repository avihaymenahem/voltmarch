param(
    [Parameter(Mandatory = $true)]
    [string]$ModelPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$resolvedModel = Resolve-Path -LiteralPath $ModelPath
$modelBytes = [IO.File]::ReadAllBytes($resolvedModel)
$modelDataUri = 'data:model/gltf-binary;base64,' + [Convert]::ToBase64String($modelBytes)

$payload = [ordered]@{
    model_url = $modelDataUri
}

$json = $payload | ConvertTo-Json -Depth 3 -Compress
[IO.File]::WriteAllText($OutputPath, $json, [Text.UTF8Encoding]::new($false))
