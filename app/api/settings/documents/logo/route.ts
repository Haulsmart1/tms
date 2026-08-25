import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
} from "../../../../../lib/accounts/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET =
  "document-branding";

const MAX_FILE_SIZE =
  5 * 1024 * 1024;

const MIME_EXTENSIONS =
  new Map<string, string>([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
  ]);

function tenantLogoPrefix(
  tenantId: string
): string {
  return `${tenantId}/logo/`;
}

function isTenantLogoPath(
  tenantId: string,
  path: string
): boolean {
  return path.startsWith(
    tenantLogoPrefix(tenantId)
  );
}

async function signedUrl(
  admin: Awaited<
    ReturnType<
      typeof requireTenantAccess
    >
  >["admin"],
  path: string
): Promise<string | null> {
  const {
    data,
    error,
  } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(
      path,
      60 * 60
    );

  if (error) {
    return null;
  }

  return data?.signedUrl ?? null;
}

export async function POST(
  request: NextRequest
) {
  try {
    const formData =
      await request.formData();

    const tenantId =
      String(
        formData.get("tenantId") ??
          ""
      ).trim();

    const file =
      formData.get("file");

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !(file instanceof File)
    ) {
      return NextResponse.json(
        {
          error:
            "A logo file is required.",
        },
        {
          status: 400,
        }
      );
    }

    const extension =
      MIME_EXTENSIONS.get(
        file.type
      );

    if (!extension) {
      return NextResponse.json(
        {
          error:
            "Logo must be PNG, JPG or WEBP.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      file.size <= 0 ||
      file.size >
        MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          error:
            "Logo must be 5 MB or smaller.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      admin,
    } =
      await requireTenantAccess(
        tenantId,
        ACCOUNTS_ADMIN_ROLES
      );

    const {
      data:
        existingSettings,
      error:
        existingSettingsError,
    } = await admin
      .from(
        "document_settings"
      )
      .select(
        "logo_path"
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (
      existingSettingsError
    ) {
      throw new Error(
        existingSettingsError.message
      );
    }

    const oldPath =
      String(
        existingSettings?.logo_path ??
          ""
      );

    const newPath =
      `${tenantLogoPrefix(
        tenantId
      )}${crypto.randomUUID()}.${extension}`;

    const bytes =
      Buffer.from(
        await file.arrayBuffer()
      );

    const {
      error:
        uploadError,
    } = await admin.storage
      .from(BUCKET)
      .upload(
        newPath,
        bytes,
        {
          contentType:
            file.type,

          cacheControl:
            "3600",

          upsert:
            false,
        }
      );

    if (uploadError) {
      throw new Error(
        uploadError.message
      );
    }

    const {
      error:
        settingsError,
    } = await admin
      .from(
        "document_settings"
      )
      .upsert(
        {
          tenant_id:
            tenantId,

          logo_path:
            newPath,

          show_logo:
            true,
        },
        {
          onConflict:
            "tenant_id",
        }
      );

    if (settingsError) {
      await admin.storage
        .from(BUCKET)
        .remove([
          newPath,
        ]);

      throw new Error(
        settingsError.message
      );
    }

    if (
      oldPath &&
      oldPath !== newPath &&
      isTenantLogoPath(
        tenantId,
        oldPath
      )
    ) {
      await admin.storage
        .from(BUCKET)
        .remove([
          oldPath,
        ]);
    }

    const logoSignedUrl =
      await signedUrl(
        admin,
        newPath
      );

    return NextResponse.json({
      ok: true,
      logoPath:
        newPath,
      logoSignedUrl,
    });
  }
  catch (error) {
    const result =
      errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status:
          result.status,
      }
    );
  }
}

export async function DELETE(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    const tenantId =
      String(
        body.tenantId ?? ""
      ).trim();

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      admin,
    } =
      await requireTenantAccess(
        tenantId,
        ACCOUNTS_ADMIN_ROLES
      );

    const {
      data:
        settings,
      error:
        settingsReadError,
    } = await admin
      .from(
        "document_settings"
      )
      .select(
        "logo_path"
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (
      settingsReadError
    ) {
      throw new Error(
        settingsReadError.message
      );
    }

    const currentPath =
      String(
        settings?.logo_path ??
          ""
      );

    const {
      error:
        settingsUpdateError,
    } = await admin
      .from(
        "document_settings"
      )
      .update({
        logo_path:
          null,
      })
      .eq(
        "tenant_id",
        tenantId
      );

    if (
      settingsUpdateError
    ) {
      throw new Error(
        settingsUpdateError.message
      );
    }

    if (
      currentPath &&
      isTenantLogoPath(
        tenantId,
        currentPath
      )
    ) {
      const {
        error:
          removeError,
      } = await admin.storage
        .from(BUCKET)
        .remove([
          currentPath,
        ]);

      if (removeError) {
        throw new Error(
          removeError.message
        );
      }
    }

    return NextResponse.json({
      ok: true,
    });
  }
  catch (error) {
    const result =
      errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status:
          result.status,
      }
    );
  }
}