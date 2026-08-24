param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Task')]
    [string]$InputTaskId,

    [Parameter(Mandatory = $true, ParameterSetName = 'Model')]
    [string]$ModelPath,

    [Parameter(Mandatory = $true)]
    [string]$StyleImage,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$resolvedStyleImage = Resolve-Path -LiteralPath $StyleImage
$styleBytes = [IO.File]::ReadAllBytes($resolvedStyleImage)
$styleDataUri = 'data:image/png;base64,' + [Convert]::ToBase64String($styleBytes)

$payload = [ordered]@{
    image_style_url = $styleDataUri
    ai_model = 'latest'
    enable_original_uv = $true
    enable_pbr = $true
    hd_texture = $false
    remove_lighting = $true
    target_formats = @('glb')
}

if ($PSCmdlet.ParameterSetName -eq 'Model') {
    $resolvedModel = Resolve-Path -LiteralPath $ModelPath
    $modelBytes = [IO.File]::ReadAllBytes($resolvedModel)
    $payload.model_url = 'data:model/gltf-binary;base64,' + [Convert]::ToBase64String($modelBytes)
} else {
    $payload.input_task_id = $InputTaskId
}

$json = $payload | ConvertTo-Json -Depth 5 -Compress
[IO.File]::WriteAllText($OutputPath, $json, [Text.UTF8Encoding]::new($false))
